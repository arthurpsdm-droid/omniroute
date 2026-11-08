import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { sandbox, fakeApi, allText, ROOT } from "./helpers.mjs";

const CLI = path.join(ROOT, "bin", "claude-tab.mjs");

function runCli(args, env, input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}

let sb, api;
beforeEach(async () => {
  sb = sandbox();
  api = await fakeApi((body, n) => ({ content: [{ type: "text", text: `Resposta ${n}` }] }));
  sb.env.ANTHROPIC_BASE_URL = api.url;
});
afterEach(async () => {
  await api.close();
  sb.cleanup();
});

test("perguntar entrega a resposta na tela, na notificação e na área de transferência", async () => {
  const r = await runCli(["perguntar", "Qual a capital do Brasil?", "--notificar", "--copiar"], sb.env);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), "Resposta 1");
  const calls = sb.calls();
  assert.match(calls, /CALL termux-notification --id claude-tab-resposta .*--button1 Copiar/);
  assert.match(calls, /CALL termux-clipboard-set\nSTDIN Resposta 1/);
  assert.match(allText(api.requests[0].body), /capital do Brasil/);
  const salvo = fs.readFileSync(path.join(sb.home, ".cache", "claude-tab", "ultima-resposta.md"), "utf8");
  assert.equal(salvo, "Resposta 1");
});

test("perguntar aceita texto pelo stdin e anexo de imagem", async () => {
  const r = await runCli(["perguntar", "O que é isto?", "-a", sb.image], sb.env, "conteúdo do pipe");
  assert.equal(r.code, 0, r.stderr);
  const blocks = api.requests[0].body.messages[0].content;
  assert.equal(blocks[0].type, "image");
  assert.match(blocks[1].text, /conteúdo do pipe/);
  assert.equal(blocks[2].text, "O que é isto?");
});

test("menu Compartilhar com link pede para o Claude ler a página", async () => {
  sb.env.MOCK_SHEET = "Resumir";
  const r = await runCli(["compartilhado", "https://exemplo.com/artigo"], sb.env);
  assert.equal(r.code, 0, r.stderr);
  const texto = allText(api.requests[0].body);
  assert.match(texto, /^Resuma/);
  assert.match(texto, /web_fetch.*https:\/\/exemplo\.com\/artigo/);
  assert.match(sb.calls(), /CALL termux-dialog sheet -t Claude: link compartilhado -v Resumir,/);
  assert.match(sb.calls(), /CALL termux-notification /);
});

test("menu Compartilhar com arquivo anexa o conteúdo", async () => {
  sb.env.MOCK_SHEET = "Perguntar outra coisa…";
  sb.env.MOCK_DIALOG_TEXT = "Quem assina?";
  const doc = path.join(sb.dir, "contrato.txt");
  fs.writeFileSync(doc, "Assinado por Maria.");
  const r = await runCli(["compartilhado", doc], sb.env);
  assert.equal(r.code, 0, r.stderr);
  const texto = allText(api.requests[0].body);
  assert.match(texto, /Conteúdo do arquivo "contrato.txt"/);
  assert.match(texto, /Quem assina\?/);
});

test("cancelar o menu não chama a API", async () => {
  sb.env.MOCK_SHEET = "";
  const r = await runCli(["compartilhado", "um texto qualquer"], sb.env);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(api.requests.length, 0);
});

test("area usa o texto copiado com a instrução dada", async () => {
  sb.env.MOCK_CLIPBOARD = "texto em inglês";
  const r = await runCli(["area", "Traduza"], sb.env);
  assert.equal(r.code, 0, r.stderr);
  assert.match(allText(api.requests[0].body), /Traduza\n\n---\ntexto em inglês/);
});

test("tela envia a captura de tela mais recente", async () => {
  const shots = path.join(sb.home, "storage", "shared", "DCIM", "Screenshots");
  fs.mkdirSync(shots, { recursive: true });
  fs.copyFileSync(sb.image, path.join(shots, "Screenshot_1.png"));
  const r = await runCli(["tela", "Que erro é esse?"], sb.env);
  assert.equal(r.code, 0, r.stderr);
  const blocks = api.requests[0].body.messages[0].content;
  assert.equal(blocks[0].type, "image");
  assert.equal(blocks[1].text, "Que erro é esse?");
});

test("voz: ouve, responde em voz alta e encerra com 'tchau'", async () => {
  const fila = path.join(sb.dir, "stt.txt");
  fs.writeFileSync(fila, "qual a capital da França\ntchau\n");
  sb.env.MOCK_STT_FILE = fila;
  const r = await runCli(["voz"], sb.env);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(api.requests.length, 1);
  assert.match(r.stdout, /Você: qual a capital da França\nClaude: Resposta 1/);
  const calls = sb.calls();
  assert.match(calls, /CALL termux-tts-speak -l pt -n BR\nSTDIN Resposta 1/);
  assert.match(calls, /STDIN Até mais!/);
  assert.match(JSON.stringify(api.requests[0].body.system), /MODO VOZ/);
});

test("erro de autenticação vira mensagem em português", async () => {
  await api.close();
  const http = await import("node:http");
  const srv = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }));
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  sb.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${srv.address().port}`;
  try {
    const r = await runCli(["perguntar", "oi"], sb.env);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /claude-tab configurar/);
  } finally {
    srv.close();
    api = await fakeApi(() => ({ content: [] })); // para o afterEach
  }
});

test("diagnostico identifica o tablet e os componentes", async () => {
  const r = await runCli(["diagnostico"], sb.env);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Galaxy Tab S10 Ultra \(SM-X920\) · Android 16 · One UI 8\.5/);
  assert.match(r.stdout, /✅ app Termux:API respondendo/);
  assert.match(r.stdout, /✅ chave da API configurada/);
});

test("lê a chave do arquivo de configuração", async () => {
  delete sb.env.ANTHROPIC_API_KEY;
  fs.mkdirSync(sb.env.CLAUDE_TAB_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(path.join(sb.env.CLAUDE_TAB_CONFIG_DIR, "env"), 'export ANTHROPIC_API_KEY="sk-ant-do-arquivo"\n');
  const r = await runCli(["perguntar", "oi"], sb.env);
  assert.equal(r.code, 0, r.stderr);
  const h = api.requests[0].headers;
  assert.ok(h["x-api-key"] === "sk-ant-do-arquivo" || h.authorization === "Bearer sk-ant-do-arquivo");
});

test("voz: comando simples é resolvido no tablet, sem chamar o Claude", async () => {
  const fila = path.join(sb.dir, "stt.txt");
  fs.writeFileSync(fila, "abaixa o brilho para 30 por cento\ncomo está a bateria\ntchau\n");
  sb.env.MOCK_STT_FILE = fila;
  const r = await runCli(["voz"], sb.env);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(api.requests.length, 0, "nenhuma chamada à API");
  const calls = sb.calls();
  assert.match(calls, /CALL termux-brightness 77\n/);
  assert.match(calls, /STDIN Pronto, brilho em 30%\./);
  assert.match(calls, /STDIN A bateria está em 80% e não está carregando\./);
  assert.match(r.stdout, /comando local, sem custo/);
});

test("modo assinatura: perguntar usa o Claude Code e não a API", async () => {
  sb.env.CLAUDE_TAB_BACKEND = "claude-code";
  const r = await runCli(["perguntar", "Qual a capital do Brasil?"], sb.env);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), "Resposta via assinatura 1");
  assert.equal(api.requests.length, 0);
  const calls = sb.calls();
  assert.match(calls, /CALL claude -p --output-format json /);
  assert.match(calls, /APIKEY=<vazio>/, "a chave da API não chega ao Claude Code");
  assert.match(calls, /STDIN Qual a capital do Brasil\?/);
});

test("usar-assinatura testa o Claude Code e grava a escolha", async () => {
  const r = await runCli(["usar-assinatura"], sb.env);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /✅ 2\.1\.400 \(Claude Code\)/);
  assert.match(r.stdout, /sem custo por resposta/);
  const env = fs.readFileSync(path.join(sb.env.CLAUDE_TAB_CONFIG_DIR, "env"), "utf8");
  assert.match(env, /^CLAUDE_TAB_BACKEND=claude-code$/m);
  const diag = await runCli(["diagnostico"], { ...sb.env, ANTHROPIC_API_KEY: "" });
  assert.match(diag.stdout, /Modo de cobrança: assinatura \(Claude Code\): sem custo por resposta/);
  assert.match(diag.stdout, /✅ Claude Code respondendo \(2\.1\.400 \(Claude Code\)\)/);
  const volta = await runCli(["usar-api"], sb.env);
  assert.match(volta.stdout, /voltou a responder pela API/);
  assert.match(fs.readFileSync(path.join(sb.env.CLAUDE_TAB_CONFIG_DIR, "env"), "utf8"), /^CLAUDE_TAB_BACKEND=api$/m);
});
