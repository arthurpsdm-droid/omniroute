import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MOCK_BIN = path.join(ROOT, "test", "mock-bin");

// PNG 1×1 válido.
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/** Cria um diretório temporário com HOME falso, log dos mocks e uma imagem. */
export function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-tab-test-"));
  const home = path.join(dir, "home");
  fs.mkdirSync(home);
  const image = path.join(dir, "fixture.png");
  fs.writeFileSync(image, Buffer.from(PNG_1X1, "base64"));
  const log = path.join(dir, "mock.log");
  fs.writeFileSync(log, "");
  const env = {
    ...process.env,
    PATH: `${MOCK_BIN}:${process.env.PATH}`,
    HOME: home,
    MOCK_LOG: log,
    MOCK_FIXTURE_IMAGE: image,
    CLAUDE_TAB_CONFIG_DIR: path.join(dir, "config"),
    ANTHROPIC_API_KEY: "sk-ant-teste",
  };
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_PROFILE;
  return {
    dir,
    home,
    image,
    env,
    calls: () => fs.readFileSync(log, "utf8"),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** Aplica o ambiente do sandbox ao processo atual (para testes in-process). */
export function useSandboxEnv(sb) {
  const saved = { ...process.env };
  Object.assign(process.env, sb.env);
  return () => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  };
}

/**
 * Servidor falso da API do Claude. `responder(body, n)` devolve o conteúdo e
 * o stop_reason da n-ésima resposta (n começa em 1).
 */
export async function fakeApi(responder) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => (raw += d));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      requests.push({ url: req.url, headers: req.headers, body });
      const n = requests.length;
      const { content, stop_reason = "end_turn", stop_details = null } = responder(body, n);
      const msg = {
        id: `msg_${n}`,
        type: "message",
        role: "assistant",
        model: body.model,
        content,
        stop_reason,
        stop_details,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(msg));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, requests, close: () => new Promise((r) => server.close(r)) };
}

/** Todos os blocos de texto de todas as mensagens de um corpo de requisição. */
export function allText(body) {
  return body.messages
    .flatMap((m) => (typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content))
    .map((b) => {
      if (b.type === "text") return b.text;
      if (b.type !== "tool_result") return "";
      if (typeof b.content === "string") return b.content;
      return (b.content ?? []).map((c) => c.text ?? "").join("\n");
    })
    .join("\n");
}
