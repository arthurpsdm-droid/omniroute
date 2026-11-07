// Modo estudo: o Claude fica de prontidão enquanto você estuda.
//
//   claude-tab estudo            notificação fixa com os botões Escrever / Falar / Encerrar
//   claude-tab estudo --escutar  + escuta contínua: só responde a frases que começam
//                                com "Claude, …" (o resto é descartado no tablet)
//
// Os botões da notificação rodam `claude-tab estudo-acao <ação>`, que avisa o
// processo do modo estudo por HTTP em 127.0.0.1 (com um token guardado num
// arquivo que só o Termux lê). Assim a conversa inteira fica num processo só e
// o Claude lembra das perguntas anteriores da sessão.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { run, runJson } from "./termux.mjs";
import { Conversa, SYSTEM_BASE, explainError } from "./claude.mjs";
import { falar, ouvir } from "./tools.mjs";
import { CACHE_DIR, binTermux, notificarResposta, aviso } from "./entrega.mjs";

export const ESTADO_FILE = path.join(CACHE_DIR, "estudo.json");
export const NOTIF_ID = "claude-tab-estudo";
export const ACOES = ["escrever", "falar", "encerrar"];

export const SYSTEM_ESTUDO = `${SYSTEM_BASE}

MODO ESTUDO: o usuário está estudando no tablet (Samsung Notes, PDFs, livros, aulas) e chama você por voz ou por escrita, sem sair do que está fazendo.
- Aja como um tutor paciente: explique com exemplos simples e, quando fizer sentido, termine com uma pergunta curta para ver se ele entendeu.
- Mensagens que começam com [voz] terão a resposta lida em voz alta: frases curtas, sem Markdown, sem listas, sem emojis, no máximo umas quatro frases, salvo se ele pedir detalhes.
- Mensagens que começam com [escrita] terão a resposta mostrada numa notificação: até uns quatro parágrafos curtos; listas simples são permitidas.
- Se ele pedir para você olhar a tela, o exercício ou a anotação, use ultima_captura_de_tela (ele precisa ter feito uma captura antes; se não houver, peça uma).
- A sessão já é registrada automaticamente numa nota; só use salvar_nota se ele pedir uma nota separada.`;

const ENCERRAR = /^(encerra(r)?|termina(r)?|para(r)?|sair|tchau|fim)\b/i;

function semAcento(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Verifica se a frase começa com a palavra de ativação ("Claude, …",
 * "Ei Claude …") e devolve o pedido que vem depois dela.
 * @returns {{ativado: boolean, pedido: string}}
 */
export function extrairPedido(frase, palavras) {
  const original = frase.normalize("NFC").trim();
  const norm = semAcento(original);
  for (const p of palavras) {
    const alvo = semAcento(p).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^(?:(?:ei|ok|oi|o|hey|e ai)[,\\s]+)?${alvo}(?![a-z0-9])[\\s,.:;!?-]*`);
    const m = norm.match(re);
    if (m) return { ativado: true, pedido: original.slice(m[0].length).trim() };
  }
  return { ativado: false, pedido: "" };
}

/** Fila de comandos: botões chegam a qualquer momento; o laço atende um por vez. */
class Fila {
  constructor() {
    this.itens = [];
    this.esperando = null;
  }
  push(cmd) {
    if (this.esperando) {
      const r = this.esperando;
      this.esperando = null;
      r(cmd);
    } else this.itens.push(cmd);
  }
  proximo(padrao) {
    if (this.itens.length) return Promise.resolve(this.itens.shift());
    if (padrao) return Promise.resolve(padrao);
    return new Promise((r) => (this.esperando = r));
  }
}

function hora(d = new Date()) {
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Registro da sessão em Documentos/Claude (criado na primeira pergunta). */
class NotaSessao {
  constructor(dir) {
    this.dir = dir;
    this.file = null;
    this.total = 0;
  }
  async anotar(origem, pergunta, resposta) {
    if (!this.file) {
      await fs.mkdir(this.dir, { recursive: true });
      this.file = path.join(this.dir, `estudo-${stamp()}.md`);
      const dia = new Date().toLocaleDateString("pt-BR");
      await fs.writeFile(this.file, `# Sessão de estudo · ${dia}\n`, "utf8");
    }
    this.total += 1;
    await fs.appendFile(
      this.file,
      `\n## ${hora()} · ${origem}\n\n**Pergunta:** ${pergunta}\n\n**Claude:** ${resposta}\n`,
      "utf8",
    );
    await run("termux-media-scan", [this.file], { timeoutMs: 10_000 }).catch(() => {});
  }
}

async function mostrarNotificacao(escutar) {
  const cmd = `${binTermux()}/claude-tab estudo-acao`;
  await run("termux-notification", [
    "--id", NOTIF_ID,
    "--group", "claude-tab",
    "--ongoing",
    "--alert-once",
    "--title", "Claude · modo estudo",
    "--content", escutar
      ? 'Diga "Claude," e a sua pergunta. Ou toque em Escrever.'
      : "Toque em Escrever (S Pen ou teclado) ou em Falar.",
    "--button1", "Escrever",
    "--button1-action", `${cmd} escrever`,
    "--button2", "Falar",
    "--button2-action", `${cmd} falar`,
    "--button3", "Encerrar",
    "--button3-action", `${cmd} encerrar`,
  ]);
}

async function caixaDeTexto() {
  const r = await runJson(
    "termux-dialog",
    ["text", "-m", "-t", "Pergunte ao Claude", "-i", "Escreva com a S Pen ou com o teclado"],
    { timeoutMs: 600_000 },
  );
  return r?.code === -1 && r.text ? r.text.trim() : "";
}

/**
 * Roda o modo estudo até o usuário encerrar.
 * @param {{settings: ReturnType<import("./config.mjs").settings>, escutar?: boolean,
 *          log?: (...a:any[]) => void, conversa?: Conversa}} opts
 */
export async function modoEstudo({ settings, escutar = false, log = console.log, conversa } = {}) {
  if (await acaoAtiva("ping")) {
    await aviso("O modo estudo já está ativo. Use a notificação do Claude.");
    log("O modo estudo já está ativo.");
    return;
  }

  const fila = new Fila();
  const token = crypto.randomBytes(16).toString("hex");
  const server = http.createServer((req, res) => {
    const acao = (req.url || "").replace(/^\//, "");
    if (req.method !== "POST" || req.headers["x-token"] !== token) {
      res.writeHead(403).end();
      return;
    }
    if (acao === "ping") {
      res.writeHead(204).end();
      return;
    }
    if (!ACOES.includes(acao)) {
      res.writeHead(404).end();
      return;
    }
    fila.push(acao);
    res.writeHead(204).end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(ESTADO_FILE, JSON.stringify({ port: server.address().port, token, pid: process.pid }), {
    mode: 0o600,
  });

  const lang = settings.language;
  const nota = new NotaSessao(settings.notesDir);
  conversa ??= new Conversa({
    settings,
    system: SYSTEM_ESTUDO,
    effort: settings.studyEffort,
    onToolCall: (tool) => log(`  → ${tool.title}`),
  });

  let encerrado = false;
  const encerrar = async () => {
    if (encerrado) return;
    encerrado = true;
    server.close();
    await fs.rm(ESTADO_FILE, { force: true });
    await run("termux-notification-remove", [NOTIF_ID]).catch(() => {});
    await run("termux-wake-unlock").catch(() => {});
    const onde = !nota.file
      ? ""
      : nota.total === 1
        ? ` A pergunta está em ${nota.file}`
        : ` As ${nota.total} perguntas estão em ${nota.file}`;
    log(`\nModo estudo encerrado.${onde}`);
    if (nota.file) await aviso(`Sessão salva em Documentos/Claude (${path.basename(nota.file)})`);
  };
  const porSinal = () => {
    fila.push("encerrar");
  };
  process.once("SIGINT", porSinal);
  process.once("SIGTERM", porSinal);

  async function perguntar(origem, texto) {
    log(`\nVocê (${origem}): ${texto}`);
    aviso("Claude está pensando…");
    let resposta;
    try {
      resposta = (await conversa.enviar(`[${origem}] ${texto}`)).text;
    } catch (err) {
      resposta = `Erro: ${explainError(err)}`;
    }
    log(`Claude: ${resposta}`);
    await nota.anotar(origem, texto, resposta).catch((e) => log(`(aviso) ${e.message}`));
    await notificarResposta(resposta, { titulo: "Claude · estudo" }).catch((e) => log(`(aviso) ${e.message}`));
    if (origem === "voz") await falar(resposta, lang).catch((e) => log(`(aviso) ${e.message}`));
  }

  async function ouvirPergunta() {
    aviso("🎙️ Ouvindo…");
    return ouvir().catch((e) => {
      log(`(aviso) ${e.message}`);
      return "";
    });
  }

  /** Um ciclo da escuta contínua. Devolve "encerrar" para sair. */
  async function cicloEscuta() {
    const frase = await ouvir().catch(() => "");
    if (!frase) {
      await new Promise((r) => setTimeout(r, 300));
      return;
    }
    const { ativado, pedido } = extrairPedido(frase, settings.wakeWords);
    if (!ativado) {
      // Fica só na tela do Termux; não é enviado ao Claude.
      log(`  (ignorado: "${frase}")`);
      return;
    }
    let p = pedido;
    if (!p) {
      await falar("Pode falar.", lang).catch(() => {});
      p = await ouvir().catch(() => "");
      if (!p) return;
    }
    if (ENCERRAR.test(p)) return "encerrar";
    await perguntar("voz", p);
  }

  try {
    await run("termux-wake-lock").catch(() => {});
    await mostrarNotificacao(escutar);
    log(
      escutar
        ? 'Modo estudo com escuta ligado. Diga "Claude," e a sua pergunta. "Claude, encerrar" para sair.'
        : "Modo estudo ligado. Use os botões da notificação do Claude.",
    );
    await falar(
      escutar ? "Modo estudo ligado. Quando precisar, diga Claude e a sua pergunta." : "Modo estudo ligado.",
      lang,
    ).catch(() => {});

    for (;;) {
      const cmd = await fila.proximo(escutar ? "ouvir" : null);
      if (cmd === "encerrar") break;
      if (cmd === "ouvir") {
        if ((await cicloEscuta()) === "encerrar") break;
      } else if (cmd === "falar") {
        const p = await ouvirPergunta();
        if (!p) aviso("Não ouvi nada.");
        else if (ENCERRAR.test(p)) break;
        else await perguntar("voz", p);
      } else if (cmd === "escrever") {
        const p = await caixaDeTexto();
        if (p) await perguntar("escrita", p);
      }
    }
  } finally {
    process.removeListener("SIGINT", porSinal);
    process.removeListener("SIGTERM", porSinal);
    await encerrar();
  }
}

/** Envia uma ação ao modo estudo em execução. Devolve false se ele não estiver ativo. */
export async function acaoAtiva(acao) {
  let estado;
  try {
    estado = JSON.parse(await fs.readFile(ESTADO_FILE, "utf8"));
  } catch {
    return false;
  }
  try {
    const r = await fetch(`http://127.0.0.1:${estado.port}/${acao}`, {
      method: "POST",
      headers: { "x-token": estado.token },
      signal: AbortSignal.timeout(3000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Usado pelos botões da notificação. */
export async function enviarAcao(acao) {
  if (!ACOES.includes(acao)) throw new Error(`Ação desconhecida: ${acao}. Use ${ACOES.join(", ")}.`);
  if (await acaoAtiva(acao)) return true;
  // O processo do modo estudo não está mais rodando: limpa a notificação que sobrou.
  await run("termux-notification-remove", [NOTIF_ID]).catch(() => {});
  if (acao !== "encerrar") await aviso('O modo estudo não está ativo. Abra o atalho "Claude Estudo".');
  return false;
}
