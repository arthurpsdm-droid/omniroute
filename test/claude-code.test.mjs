import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { sandbox, useSandboxEnv } from "./helpers.mjs";
import { settings } from "../src/config.mjs";
import { ConversaClaudeCode, ambienteSemChave, lerResultado, montarPrompt, mcpConfig } from "../src/claude-code.mjs";
import { criarConversa } from "../src/backend.mjs";
import { Conversa } from "../src/claude.mjs";

let sb, restore;
before(() => {
  sb = sandbox();
  restore = useSandboxEnv(sb);
});
after(() => {
  restore();
  sb.cleanup();
});

const cfg = () => ({ ...settings(), backend: "claude-code" });

// Uma chamada ao "claude" ocupa várias linhas no registro (o prompt de sistema tem quebras).
function args(calls, n) {
  return calls.split(/^CALL /m).filter((b) => b.startsWith("claude -p"))[n] ?? "";
}

test("a fábrica escolhe o backend pela configuração", () => {
  assert.ok(criarConversa({ settings: cfg() }) instanceof ConversaClaudeCode);
  assert.ok(criarConversa({ settings: { ...settings(), backend: "api" } }) instanceof Conversa);
});

test("o Claude Code recebe as ferramentas do tablet, sem chave da API, e continua a sessão", async () => {
  const c = new ConversaClaudeCode({ settings: cfg(), voz: true });
  const r1 = await c.enviar("primeira pergunta");
  assert.equal(r1.text, "Resposta via assinatura 1");
  assert.equal(c.sessionId, "sess-1");
  const r2 = await c.enviar("segunda pergunta");
  assert.equal(r2.text, "Resposta via assinatura 2");

  const calls = sb.calls();
  const a1 = args(calls, 0);
  assert.match(a1, /--permission-mode dontAsk/);
  assert.match(a1, /--disallowedTools Bash,Edit,Write,NotebookEdit/);
  assert.match(a1, /--allowedTools Read,WebSearch,WebFetch,mcp__tablet__info_tablet,mcp__tablet__bateria,/);
  assert.match(a1, /--strict-mcp-config/);
  assert.doesNotMatch(a1, /--resume/);
  assert.match(args(calls, 1), /--resume sess-1/);
  assert.equal((calls.match(/APIKEY=<vazio>/g) ?? []).length, 2);
  assert.match(calls, /MODO VOZ/);
});

test("ambiente do Claude Code não leva credenciais da API", () => {
  const env = ambienteSemChave({ ANTHROPIC_API_KEY: "sk-ant-x", ANTHROPIC_AUTH_TOKEN: "t", PATH: "/bin" });
  assert.deepEqual(env, { PATH: "/bin" });
});

test("config MCP aponta para o servidor do tablet com confirmação na tela", () => {
  const m = mcpConfig({ ...cfg(), confirm: "digital" });
  assert.match(m.mcpServers.tablet.args[0], /bin\/claude-tab-mcp\.mjs$/);
  assert.equal(m.mcpServers.tablet.env.CLAUDE_TAB_CONFIRMAR_MCP, "digital");
  assert.equal(m.mcpServers.tablet.env.ANTHROPIC_API_KEY, undefined);
});

test("imagens anexadas viram arquivos que o Claude Code abre com Read", async () => {
  const png = fs.readFileSync(sb.image).toString("base64");
  const prompt = await montarPrompt([
    { type: "image", source: { type: "base64", media_type: "image/png", data: png } },
    { type: "text", text: "O que é isto?" },
  ]);
  const m = prompt.match(/\[Arquivo anexado: (.+\.png) \(abra com a ferramenta Read\)\]/);
  assert.ok(m, prompt);
  assert.deepEqual(fs.readFileSync(m[1]), fs.readFileSync(sb.image));
  assert.match(prompt, /O que é isto\?$/);
});

test("limite do plano vira explicação em português", async () => {
  process.env.MOCK_CLAUDE_ERRO = "Claude AI usage limit reached";
  try {
    const c = new ConversaClaudeCode({ settings: cfg() });
    await assert.rejects(() => c.enviar("oi"), /limite de uso do seu plano/);
  } finally {
    delete process.env.MOCK_CLAUDE_ERRO;
  }
});

test("lerResultado ignora avisos antes do JSON", () => {
  assert.equal(lerResultado('aviso qualquer\n{"result":"ok","session_id":"s"}\n').result, "ok");
  assert.equal(lerResultado("sem json"), null);
});
