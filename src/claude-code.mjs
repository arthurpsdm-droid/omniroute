// Backend "assinatura": as respostas vêm do Claude Code oficial, logado na SUA
// assinatura do Claude (Pro, Max ou Ultra). Não há cobrança por resposta: o uso
// conta nos limites do plano.
//
// Regras que este módulo segue (termos da Anthropic, página "Legal and
// compliance" do Claude Code):
//   - roda o programa `claude` oficial, sem modificações, com o seu próprio login;
//   - nunca lê, copia ou reaproveita o token de login do Claude Code;
//   - remove ANTHROPIC_API_KEY do ambiente do `claude`, para que ele use a
//     assinatura e não a cobrança por uso da API.
//
// As ferramentas do tablet chegam ao Claude Code pelo servidor MCP do claude-tab.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { run, hasCommand, TermuxError } from "./termux.mjs";
import { TOOLS } from "./tools.mjs";
import { SYSTEM_BASE, SYSTEM_VOZ } from "./claude.mjs";
import { CACHE_DIR } from "./entrega.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const MCP_SCRIPT = path.resolve(AQUI, "..", "bin", "claude-tab-mcp.mjs");
const ANEXOS_DIR = path.join(CACHE_DIR, "anexos");

// Dentro do Ubuntu: carrega o perfil (PATH com ~/.local/bin), garante que
// nenhuma chave de API vaze para o Claude Code e roda sempre na mesma pasta,
// para que --resume encontre a conversa.
const SCRIPT_UBUNTU =
  'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL; cd ~ && exec claude "$@"';

export const NOTA_FERRAMENTAS =
  "No Claude Code, as ferramentas do tablet aparecem com o prefixo mcp__tablet__ (ex.: mcp__tablet__bateria). " +
  "Para ver arquivos anexados (imagens, PDFs), use a ferramenta Read no caminho indicado.";

/** Linha de comando para chamar o Claude Code (lista: programa + argumentos fixos). */
export async function comandoClaude(settings) {
  if (settings.claudeCmd) return settings.claudeCmd.split(/\s+/).filter(Boolean);
  if (await hasCommand("claude")) return ["claude"];
  return ["proot-distro", "login", "ubuntu", "--", "bash", "-lc", SCRIPT_UBUNTU, "claude"];
}

/** Ambiente sem credenciais de API: o Claude Code usa o login da assinatura. */
export function ambienteSemChave(base = process.env) {
  const env = { ...base };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_BASE_URL;
  return env;
}

/** Configuração MCP que dá ao Claude Code as ferramentas do tablet. */
export function mcpConfig(settings) {
  const env = {
    HOME: os.homedir(),
    PATH: process.env.PATH ?? "",
    PREFIX: process.env.PREFIX ?? "/data/data/com.termux/files/usr",
    // No modo não interativo o Claude Code não consegue perguntar nada a você;
    // as ações sensíveis continuam pedindo confirmação na tela do tablet.
    CLAUDE_TAB_CONFIRMAR_MCP: settings.confirm,
  };
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("CLAUDE_TAB_") && k !== "CLAUDE_TAB_CONFIRMAR_MCP" && v !== undefined) env[k] = v;
  }
  return { mcpServers: { tablet: { command: process.execPath, args: [MCP_SCRIPT], env } } };
}

function extensao(mediaType) {
  return { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "application/pdf": ".pdf" }[
    mediaType
  ] ?? ".bin";
}

async function limparAnexosAntigos() {
  let nomes = [];
  try {
    nomes = await fs.readdir(ANEXOS_DIR);
  } catch {
    return;
  }
  const limite = Date.now() - 24 * 3600 * 1000;
  await Promise.all(
    nomes.map(async (n) => {
      const f = path.join(ANEXOS_DIR, n);
      const st = await fs.stat(f).catch(() => null);
      if (st && st.mtimeMs < limite) await fs.rm(f, { force: true });
    }),
  );
}

/**
 * Converte o conteúdo (texto ou blocos da API) num prompt de texto. Imagens e
 * PDFs viram arquivos que o Claude Code abre com a ferramenta Read.
 */
export async function montarPrompt(content) {
  if (typeof content === "string") return content;
  const partes = [];
  let i = 0;
  for (const b of content) {
    if (b.type === "text") partes.push(b.text);
    else if ((b.type === "image" || b.type === "document") && b.source?.type === "base64") {
      await fs.mkdir(ANEXOS_DIR, { recursive: true });
      const arquivo = path.join(ANEXOS_DIR, `${Date.now()}-${process.pid}-${i++}${extensao(b.source.media_type)}`);
      await fs.writeFile(arquivo, Buffer.from(b.source.data, "base64"));
      partes.push(`[Arquivo anexado: ${arquivo} (abra com a ferramenta Read)]`);
    }
  }
  return partes.join("\n\n");
}

/** Lê o JSON final do `claude -p --output-format json` (ignora linhas de aviso). */
export function lerResultado(stdout) {
  const linhas = stdout.trim().split(/\r?\n/).reverse();
  for (const l of linhas) {
    const t = l.trim();
    if (!t.startsWith("{")) continue;
    try {
      return JSON.parse(t);
    } catch {}
  }
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function explicarFalha(texto) {
  if (/usage limit|limit reached|rate limit|limite/i.test(texto)) {
    return (
      "Você atingiu o limite de uso do seu plano do Claude. Ele se renova sozinho em algumas horas. " +
      "Enquanto isso, espere ou use a API (claude-tab usar-api)."
    );
  }
  if (/log ?in|logged|authenticat|\/login|credential/i.test(texto)) {
    return (
      "O Claude Code não está logado na sua assinatura. Abra o Ubuntu (proot-distro login ubuntu), rode `claude` " +
      'e entre com a conta do Claude (opção da assinatura, não a do Console). Detalhe: ' +
      texto.slice(0, 300)
    );
  }
  return `O Claude Code respondeu com erro: ${texto.slice(0, 500)}`;
}

/**
 * Conversa pelo Claude Code. Mesma interface da Conversa da API: enviar(content).
 * A sessão do Claude Code (--resume) guarda o histórico entre as perguntas.
 */
export class ConversaClaudeCode {
  constructor({ settings, voz = false, ferramentas = true, system }) {
    this.settings = settings;
    this.ferramentas = ferramentas;
    this.system = `${system ?? (voz ? SYSTEM_VOZ : SYSTEM_BASE)}\n\n${NOTA_FERRAMENTAS}`;
    this.sessionId = null;
  }

  argumentos() {
    const s = this.settings;
    const permitidas = ["Read"];
    if (s.web) permitidas.push("WebSearch", "WebFetch");
    const args = [
      "-p",
      "--output-format", "json",
      "--system-prompt", this.system,
      "--permission-mode", "dontAsk",
      "--disallowedTools", "Bash,Edit,Write,NotebookEdit",
      "--max-turns", String(s.maxIterations),
      "--strict-mcp-config",
    ];
    if (this.ferramentas) {
      permitidas.push(...TOOLS.map((t) => `mcp__tablet__${t.name}`));
      args.push("--mcp-config", JSON.stringify(mcpConfig(s)));
    }
    args.push("--allowedTools", permitidas.join(","));
    if (s.claudeModel) args.push("--model", s.claudeModel);
    if (this.sessionId) args.push("--resume", this.sessionId);
    return args;
  }

  /** @returns {Promise<{text: string}>} */
  async enviar(content) {
    await limparAnexosAntigos();
    const prompt = await montarPrompt(content);
    const [programa, ...fixos] = await comandoClaude(this.settings);
    let stdout;
    try {
      // O pedido vai pelo stdin (evita problemas com textos que começam com "-").
      stdout = await run(programa, [...fixos, ...this.argumentos()], {
        input: prompt,
        timeoutMs: 600_000,
        env: ambienteSemChave(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const dados = lerResultado(msg.replace(/^.*?:\s*/, ""));
      throw new TermuxError(explicarFalha(dados?.result ?? msg));
    }
    const dados = lerResultado(stdout);
    if (!dados) throw new TermuxError(explicarFalha(stdout || "resposta vazia"));
    if (dados.session_id) this.sessionId = dados.session_id;
    if (dados.is_error === true || String(dados.subtype ?? "").startsWith("error")) {
      throw new TermuxError(explicarFalha(String(dados.result ?? dados.subtype ?? "erro")));
    }
    return { text: String(dados.result ?? "").trim() || "(sem resposta em texto)" };
  }
}

/** Confere se o Claude Code responde (versão). */
export async function versaoClaudeCode(settings) {
  const [programa, ...fixos] = await comandoClaude(settings);
  const out = await run(programa, [...fixos, "--version"], { timeoutMs: 120_000, env: ambienteSemChave() });
  return out.trim().split(/\r?\n/).at(-1) ?? "";
}
