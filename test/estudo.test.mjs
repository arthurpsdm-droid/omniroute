import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { sandbox, fakeApi, allText, ROOT } from "./helpers.mjs";
import { extrairPedido } from "../src/estudo.mjs";

const CLI = path.join(ROOT, "bin", "claude-tab.mjs");
const PALAVRAS = ["claude", "claud", "clode", "cloud", "claudio"];

function start(args, env) {
  const child = spawn(process.execPath, [CLI, ...args], { env });
  const out = { stdout: "", stderr: "" };
  child.stdout.on("data", (d) => (out.stdout += d));
  child.stderr.on("data", (d) => (out.stderr += d));
  child.stdin.end();
  const done = new Promise((resolve) => child.on("close", (code) => resolve({ code, ...out })));
  return { child, out, done };
}

async function waitFor(fn, ms = 10_000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("tempo esgotado esperando a condição");
    await new Promise((r) => setTimeout(r, 50));
  }
}

test("palavra de ativação: só frases que começam com 'Claude' viram pedido", () => {
  assert.deepEqual(extrairPedido("Claude, o que é osmose?", PALAVRAS), { ativado: true, pedido: "o que é osmose?" });
  assert.deepEqual(extrairPedido("Ei Claude explica mitose", PALAVRAS), { ativado: true, pedido: "explica mitose" });
  assert.deepEqual(extrairPedido("ô Cláudio, qual a fórmula de Bhaskara", PALAVRAS), {
    ativado: true,
    pedido: "qual a fórmula de Bhaskara",
  });
  assert.deepEqual(extrairPedido("Claude", PALAVRAS), { ativado: true, pedido: "" });
  assert.equal(extrairPedido("vamos almoçar depois da aula", PALAVRAS).ativado, false);
  assert.equal(extrairPedido("a Claudete ligou", PALAVRAS).ativado, false);
  assert.equal(extrairPedido("eu perguntei ao Claude ontem", PALAVRAS).ativado, false);
});

let sb, api;
beforeEach(async () => {
  sb = sandbox();
  api = await fakeApi((body, n) => ({ content: [{ type: "text", text: `Resposta ${n}` }] }));
  sb.env.ANTHROPIC_BASE_URL = api.url;
  sb.env.PREFIX = "/data/data/com.termux/files/usr";
});
afterEach(async () => {
  await api.close();
  sb.cleanup();
});

test("escuta contínua: ignora conversa, responde a 'Claude, …' e encerra por voz", async () => {
  const fila = path.join(sb.dir, "stt.txt");
  fs.writeFileSync(fila, ["vamos almoçar depois da aula", "Claude, o que é osmose?", "Claude, encerrar"].join("\n") + "\n");
  sb.env.MOCK_STT_FILE = fila;
  const { done } = start(["estudo", "--escutar"], sb.env);
  const r = await done;
  assert.equal(r.code, 0, r.stderr);

  assert.equal(api.requests.length, 1, "só a frase com 'Claude' vai para a API");
  const enviado = allText(api.requests[0].body);
  assert.match(enviado, /\[voz\] o que é osmose\?/);
  assert.doesNotMatch(enviado, /almoçar/);
  assert.match(JSON.stringify(api.requests[0].body.system), /MODO ESTUDO/);
  assert.equal(api.requests[0].body.output_config.effort, "low");

  const calls = sb.calls();
  assert.match(calls, /CALL termux-notification --id claude-tab-estudo .*--ongoing .*--button1 Escrever --button1-action \/data\/data\/com\.termux\/files\/usr\/bin\/claude-tab estudo-acao escrever/);
  assert.match(calls, /CALL termux-tts-speak -l pt -n BR\nSTDIN Resposta 1/);
  assert.match(calls, /CALL termux-wake-lock/);
  assert.match(calls, /CALL termux-wake-unlock/);
  assert.match(calls, /CALL termux-notification-remove claude-tab-estudo/);
  assert.match(r.stdout, /\(ignorado: "vamos almoçar depois da aula"\)/);

  const notas = path.join(sb.home, "storage", "shared", "Documents", "Claude");
  const [arquivo] = fs.readdirSync(notas).filter((f) => f.startsWith("estudo-"));
  const nota = fs.readFileSync(path.join(notas, arquivo), "utf8");
  assert.match(nota, /^# Sessão de estudo/);
  assert.match(nota, /\*\*Pergunta:\*\* o que é osmose\?\n\n\*\*Claude:\*\* Resposta 1/);
  assert.equal(fs.existsSync(path.join(sb.home, ".cache", "claude-tab", "estudo.json")), false);
});

test("botões da notificação: Escrever envia a pergunta escrita e Encerrar termina a sessão", async () => {
  sb.env.MOCK_DIALOG_TEXT = "Explique fotossíntese";
  const estadoFile = path.join(sb.home, ".cache", "claude-tab", "estudo.json");
  const sessao = start(["estudo"], sb.env);
  const estado = await waitFor(() => fs.existsSync(estadoFile) && JSON.parse(fs.readFileSync(estadoFile, "utf8")));
  assert.equal((fs.statSync(estadoFile).mode & 0o777).toString(8), "600");

  // sem o token, o servidor local recusa
  const semToken = await fetch(`http://127.0.0.1:${estado.port}/escrever`, { method: "POST" });
  assert.equal(semToken.status, 403);

  const escrever = await start(["estudo-acao", "escrever"], sb.env).done;
  assert.equal(escrever.code, 0, escrever.stderr);
  await waitFor(() => api.requests.length === 1 && sb.calls().includes("--title Claude · estudo"));
  assert.match(allText(api.requests[0].body), /\[escrita\] Explique fotossíntese/);
  assert.match(sb.calls(), /CALL termux-dialog text -m -t Pergunte ao Claude/);
  assert.doesNotMatch(sb.calls(), /STDIN Resposta 1/, "resposta escrita não é falada");

  const encerrar = await start(["estudo-acao", "encerrar"], sb.env).done;
  assert.equal(encerrar.code, 0, encerrar.stderr);
  const r = await sessao.done;
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Modo estudo encerrado\. A pergunta está em .*estudo-.*\.md/);

  // com a sessão encerrada, o botão só limpa a notificação e avisa
  const depois = await start(["estudo-acao", "escrever"], sb.env).done;
  assert.equal(depois.code, 1);
  assert.match(sb.calls(), /STDIN O modo estudo não está ativo/);
});

test("botão Falar faz uma pergunta por voz sem precisar da palavra de ativação", async () => {
  const fila = path.join(sb.dir, "stt.txt");
  fs.writeFileSync(fila, "quanto é sete vezes oito\n");
  sb.env.MOCK_STT_FILE = fila;
  const estadoFile = path.join(sb.home, ".cache", "claude-tab", "estudo.json");
  const sessao = start(["estudo"], sb.env);
  await waitFor(() => fs.existsSync(estadoFile));
  await start(["estudo-acao", "falar"], sb.env).done;
  await waitFor(() => sb.calls().includes("STDIN Resposta 1"));
  assert.match(allText(api.requests[0].body), /\[voz\] quanto é sete vezes oito/);
  await start(["estudo-acao", "encerrar"], sb.env).done;
  assert.equal((await sessao.done).code, 0);
});
