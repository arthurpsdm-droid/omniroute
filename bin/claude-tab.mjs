#!/usr/bin/env node
// claude-tab — o Claude integrado ao Galaxy Tab S10 (via Termux).
// Rode "claude-tab ajuda" para ver os comandos.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline";
import { loadEnvFile, settings as loadSettings, CONFIG_DIR, ENV_FILE } from "../src/config.mjs";
import { Conversa, explainError } from "../src/claude.mjs";
import { run, runJson, hasCommand } from "../src/termux.mjs";
import { falar, ouvir } from "../src/tools.mjs";
import { salvarResposta, notificarResposta } from "../src/entrega.mjs";
import { fileToBlocks, imageBlock, newestImage } from "../src/attachments.mjs";
import { infoDispositivo } from "../src/device.mjs";

loadEnvFile();

const AJUDA = `claude-tab — Claude no seu Galaxy Tab S10

Uso:
  claude-tab perguntar "texto" [-a arquivo]... [--falar] [--notificar] [--copiar]
  claude-tab voz                    conversa por voz (fale; diga "tchau" para sair)
  claude-tab tela [pergunta]        analisa a última captura de tela
  claude-tab area [instrução]       trabalha com o texto copiado (área de transferência)
  claude-tab compartilhado <alvo>   usado pelo menu Compartilhar (arquivo, link ou texto)
  claude-tab estudo [--escutar]     modo estudo: notificação com Escrever/Falar/Encerrar;
                                    com --escutar, responde quando você diz "Claude, …"
  claude-tab configurar             salva a chave da API do Claude
  claude-tab diagnostico            confere a instalação
  claude-tab mcp                    inicia o servidor MCP (para o Claude Code)

Opções:
  -a, --anexo <arquivo>   anexa imagem, PDF ou texto (pode repetir)
  --falar                 lê a resposta em voz alta
  --notificar             mostra a resposta numa notificação (com botões Copiar/Compartilhar)
  --copiar                copia a resposta para a área de transferência
  --perguntar             abre uma caixa de texto para você digitar a pergunta
  --sem-ferramentas       não deixa o Claude agir no tablet (só responde)
  --escutar               (modo estudo) escuta contínua com a palavra "Claude"
`;

const MENU = [
  ["Resumir", "Resuma o conteúdo abaixo em português, com os pontos principais em tópicos curtos."],
  [
    "Responder ao que escrevi",
    "Leia o que está escrito no conteúdo abaixo (inclusive letra à mão, como numa anotação feita com a S Pen) e responda à pergunta ou ao pedido que aparece ali. Se for um exercício, explique a resolução passo a passo.",
  ],
  ["Explicar de forma simples", "Explique o conteúdo abaixo de forma simples e didática, em português."],
  ["Traduzir para português", "Traduza o conteúdo abaixo para o português do Brasil, mantendo o sentido e o tom."],
  ["Extrair tarefas e datas", "Liste as tarefas, prazos, datas e compromissos que aparecem no conteúdo abaixo."],
  ["Revisar o texto", "Revise o texto abaixo (ortografia, clareza, tom) e devolva a versão melhorada."],
  ["Salvar como nota", "Organize o conteúdo abaixo como uma nota bem estruturada e salve com a ferramenta salvar_nota."],
  ["Perguntar outra coisa…", null],
];

function log(...a) {
  if (process.stderr.isTTY) console.error(...a);
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

/** Caixa de texto na tela do tablet; devolve "" se cancelada. */
async function dialogoTexto(titulo, dica) {
  const args = ["text", "-t", titulo];
  if (dica) args.push("-i", dica);
  const r = await runJson("termux-dialog", args, { timeoutMs: 300_000 });
  return r?.code === -1 && r.text ? r.text.trim() : "";
}

/** Menu de ações (folha inferior). Devolve a instrução escolhida ou "". */
async function menuAcoes(titulo) {
  const r = await runJson(
    "termux-dialog",
    ["sheet", "-t", titulo, "-v", MENU.map(([rotulo]) => rotulo).join(",")],
    { timeoutMs: 300_000 },
  );
  const escolhido = MENU.find(([rotulo]) => rotulo === r?.text?.trim());
  if (!escolhido) return "";
  if (escolhido[1]) return escolhido[1];
  return dialogoTexto("O que você quer saber?", "Ex.: quais são os riscos citados?");
}

async function entregar(texto, opts, s) {
  console.log(texto);
  await salvarResposta(texto);
  const tarefas = [];
  if (opts.copiar) tarefas.push(run("termux-clipboard-set", [], { input: texto }));
  if (opts.notificar) tarefas.push(notificarResposta(texto));
  for (const r of await Promise.allSettled(tarefas)) {
    if (r.status === "rejected") log(`(aviso) ${r.reason?.message ?? r.reason}`);
  }
  if (opts.falar) await falar(texto, s.language).catch((e) => log(`(aviso) ${e.message}`));
}

function novaConversa(s, opts, { voz = false } = {}) {
  return new Conversa({
    settings: s,
    voz,
    ferramentas: !opts["sem-ferramentas"],
    onToolCall: (tool) => log(`  → ${tool.title}`),
  });
}

async function responder(blocks, opts) {
  const s = loadSettings();
  const conversa = novaConversa(s, opts);
  log("Claude está pensando…");
  try {
    const { text } = await conversa.enviar(blocks);
    await entregar(text, opts, s);
  } catch (err) {
    const msg = explainError(err);
    await entregar(`Erro: ${msg}`, { ...opts, copiar: false, falar: false }, s);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------- comandos

async function cmdPerguntar(pos, opts) {
  let texto = pos.join(" ").trim();
  const entrada = (await readStdin()).trim();
  if (opts.perguntar && !texto) texto = await dialogoTexto("Pergunte ao Claude");
  if (!texto && !entrada && !opts.anexo?.length) {
    console.error('Escreva a pergunta: claude-tab perguntar "texto" (ou use --perguntar).');
    process.exitCode = 2;
    return;
  }
  const blocks = [];
  for (const f of opts.anexo ?? []) blocks.push(...(await fileToBlocks(f)));
  if (entrada) blocks.push({ type: "text", text: `Conteúdo recebido:\n\n${entrada}` });
  blocks.push({ type: "text", text: texto || "Analise o conteúdo acima." });
  await responder(blocks, opts);
}

async function cmdTela(pos, opts) {
  const s = loadSettings();
  const achado = await newestImage(s.screenshotDirs);
  if (!achado) {
    await entregar(
      "Não encontrei capturas de tela. Tire uma (botões lateral + volume, ou deslizando a palma da mão) e rode de novo.",
      opts,
      s,
    );
    return;
  }
  let pergunta = pos.join(" ").trim();
  if (!pergunta && opts.perguntar) pergunta = await dialogoTexto("O que fazer com esta tela?", "Vazio = explicar");
  await responder(
    [
      await imageBlock(achado.file),
      {
        type: "text",
        text:
          pergunta ||
          "Esta é uma captura da tela do meu tablet. Explique o que aparece e me diga como posso resolver o que estiver pendente.",
      },
    ],
    opts,
  );
}

async function cmdArea(pos, opts) {
  const texto = (await run("termux-clipboard-get")).trim();
  if (!texto) {
    await entregar("A área de transferência está vazia. Copie um texto e tente de novo.", opts, loadSettings());
    return;
  }
  const instrucao = pos.join(" ").trim() || (await menuAcoes("Claude: o que fazer com o texto copiado?"));
  if (!instrucao) return;
  await responder([{ type: "text", text: `${instrucao}\n\n---\n${texto}` }], opts);
}

async function cmdCompartilhado(pos, opts) {
  const alvo = pos.join(" ").trim();
  if (!alvo) {
    console.error("Nada foi compartilhado.");
    process.exitCode = 2;
    return;
  }
  const ehArquivo = await fs
    .stat(alvo)
    .then((st) => st.isFile())
    .catch(() => false);
  const ehUrl = /^https?:\/\/\S+$/i.test(alvo);
  const instrucao = await menuAcoes(
    ehArquivo ? `Claude: ${path.basename(alvo)}` : ehUrl ? "Claude: link compartilhado" : "Claude: texto compartilhado",
  );
  if (!instrucao) return;

  let blocks;
  if (ehArquivo) blocks = [...(await fileToBlocks(alvo)), { type: "text", text: instrucao }];
  else if (ehUrl) blocks = [{ type: "text", text: `${instrucao}\n\nUse a ferramenta web_fetch para ler esta página: ${alvo}` }];
  else blocks = [{ type: "text", text: `${instrucao}\n\n---\n${alvo}` }];
  await responder(blocks, { ...opts, notificar: true });
}

const SAIR = /^(tchau|sair|encerrar|parar|chega|até mais|obrigad[oa],? (é )?só isso)\b/i;

async function cmdVoz(_pos, opts) {
  const s = loadSettings();
  const conversa = novaConversa(s, opts, { voz: true });
  await falar("Oi! Pode falar.", s.language).catch(() => {});
  let silencios = 0;
  for (;;) {
    run("termux-toast", ["-s", "-g", "top"], { input: "🎙️ Ouvindo…" }).catch(() => {});
    const fala = await ouvir().catch((e) => {
      log(`(aviso) ${e.message}`);
      return "";
    });
    if (!fala) {
      if (++silencios >= 2) {
        await falar("Não ouvi nada. Até mais!", s.language).catch(() => {});
        return;
      }
      continue;
    }
    silencios = 0;
    console.log(`\nVocê: ${fala}`);
    if (SAIR.test(fala)) {
      await falar("Até mais!", s.language).catch(() => {});
      return;
    }
    try {
      const { text } = await conversa.enviar(fala);
      console.log(`Claude: ${text}`);
      await falar(text, s.language).catch((e) => log(`(aviso) ${e.message}`));
    } catch (err) {
      const msg = explainError(err);
      console.error(`Erro: ${msg}`);
      await falar("Tive um problema para responder. " + msg, s.language).catch(() => {});
      process.exitCode = 1;
      return;
    }
  }
}

async function cmdEstudo(_pos, opts) {
  const { modoEstudo } = await import("../src/estudo.mjs");
  await modoEstudo({ settings: loadSettings(), escutar: Boolean(opts.escutar) });
}

async function cmdEstudoAcao(pos) {
  const { enviarAcao } = await import("../src/estudo.mjs");
  const ok = await enviarAcao(pos[0] ?? "");
  if (!ok) process.exitCode = 1;
}

async function perguntarOculto(rotulo) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => {
    if (s.includes(rotulo)) process.stdout.write(s);
    else if (s !== "\r\n" && s !== "\n") process.stdout.write("•");
  };
  const resposta = await new Promise((resolve) => rl.question(rotulo, resolve));
  rl.close();
  process.stdout.write("\n");
  return resposta.trim();
}

async function cmdConfigurar() {
  console.log("Crie uma chave em https://console.anthropic.com (Settings > API Keys).");
  const chave = await perguntarOculto("Cole a chave da API (sk-ant-…): ");
  if (!chave.startsWith("sk-ant-")) {
    console.error("Isso não parece uma chave da API da Anthropic (deveria começar com sk-ant-).");
    process.exitCode = 1;
    return;
  }
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  let atual = "";
  try {
    atual = await fs.readFile(ENV_FILE, "utf8");
  } catch {}
  const linhas = atual.split(/\r?\n/).filter((l) => l && !/^\s*(export\s+)?ANTHROPIC_API_KEY=/.test(l));
  linhas.unshift(`ANTHROPIC_API_KEY=${chave}`);
  await fs.writeFile(ENV_FILE, linhas.join("\n") + "\n", { mode: 0o600 });
  await fs.chmod(ENV_FILE, 0o600);
  console.log(`Chave salva em ${ENV_FILE} (somente você pode ler).`);
}

async function cmdDiagnostico() {
  const s = loadSettings();
  const ok = (b) => (b ? "✅" : "❌");
  const linhas = [];
  const info = await infoDispositivo();
  linhas.push(`Tablet: ${info.nome} (${info.numero_modelo}) · Android ${info.android} · One UI ${info.one_ui}`);
  linhas.push(`${ok(Number(process.versions.node.split(".")[0]) >= 20)} Node.js ${process.versions.node}`);
  const temApi = await hasCommand("termux-battery-status");
  linhas.push(`${ok(temApi)} pacote termux-api`);
  let appOk = false;
  if (temApi) {
    try {
      await run("termux-battery-status", [], { timeoutMs: 8_000 });
      appOk = true;
    } catch {}
  }
  linhas.push(`${ok(appOk)} app Termux:API respondendo`);
  const storage = await fs
    .stat(path.join(os.homedir(), "storage", "shared"))
    .then(() => true)
    .catch(() => false);
  linhas.push(`${ok(storage)} acesso ao armazenamento (termux-setup-storage)`);
  linhas.push(`${ok(await hasCommand("magick") || await hasCommand("convert"))} ImageMagick (reduz imagens grandes)`);
  linhas.push(`${ok(Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN))} chave da API configurada`);
  linhas.push(`${ok(await hasCommand("claude"))} Claude Code instalado (opcional)`);
  linhas.push(`Modelo: ${s.model} · esforço: ${s.effort} (voz: ${s.voiceEffort}) · confirmação: ${s.confirm}`);
  console.log(linhas.join("\n"));
}

// ---------------------------------------------------------------- main

const COMANDOS = {
  perguntar: cmdPerguntar,
  p: cmdPerguntar,
  voz: cmdVoz,
  tela: cmdTela,
  area: cmdArea,
  compartilhado: cmdCompartilhado,
  estudo: cmdEstudo,
  "estudo-acao": cmdEstudoAcao,
  configurar: cmdConfigurar,
  diagnostico: cmdDiagnostico,
};

async function main(argv = process.argv.slice(2)) {
  const { values: opts, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      anexo: { type: "string", short: "a", multiple: true },
      falar: { type: "boolean" },
      notificar: { type: "boolean" },
      copiar: { type: "boolean" },
      perguntar: { type: "boolean" },
      "sem-ferramentas": { type: "boolean" },
      escutar: { type: "boolean" },
      ajuda: { type: "boolean", short: "h" },
    },
  });
  const [cmd, ...pos] = positionals;
  if (!cmd || opts.ajuda || cmd === "ajuda" || cmd === "help") {
    console.log(AJUDA);
    return;
  }
  if (cmd === "mcp") {
    const { startStdio } = await import("../src/mcp-server.mjs");
    await startStdio();
    return;
  }
  const fn = COMANDOS[cmd];
  if (!fn) {
    console.error(`Comando desconhecido: ${cmd}\n\n${AJUDA}`);
    process.exitCode = 2;
    return;
  }
  await fn(pos, opts);
}

main().catch((err) => {
  console.error(`Erro: ${explainError(err)}`);
  process.exitCode = 1;
});
