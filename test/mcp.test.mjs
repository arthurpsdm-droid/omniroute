import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { sandbox, ROOT } from "./helpers.mjs";
import { TOOLS } from "../src/tools.mjs";

let sb, client;
before(async () => {
  sb = sandbox();
  client = new Client({ name: "teste", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(ROOT, "bin", "claude-tab-mcp.mjs")],
      env: sb.env,
      stderr: "pipe",
    }),
  );
});
after(async () => {
  await client?.close();
  sb.cleanup();
});

test("lista todas as ferramentas do tablet com anotações", async () => {
  const { tools } = await client.listTools();
  assert.equal(tools.length, TOOLS.length);
  const bateria = tools.find((t) => t.name === "bateria");
  assert.equal(bateria.annotations.readOnlyHint, true);
  const lanterna = tools.find((t) => t.name === "lanterna");
  assert.deepEqual(lanterna.inputSchema.required, ["ligar"]);
});

test("executa uma ferramenta de leitura", async () => {
  const r = await client.callTool({ name: "info_tablet", arguments: {} });
  assert.equal(r.isError, undefined);
  assert.match(r.content[0].text, /Galaxy Tab S10 Ultra/);
});

test("devolve imagem como conteúdo MCP", async () => {
  const r = await client.callTool({ name: "tirar_foto", arguments: { camera: "traseira" } });
  assert.equal(r.isError, undefined, r.content[0].text);
  const img = r.content.find((c) => c.type === "image");
  assert.equal(img.mimeType, "image/jpeg");
  assert.ok(img.data.length > 0);
  assert.match(sb.calls(), /CALL termux-camera-photo -c 0 /);
});

test("erro de ferramenta volta com isError", async () => {
  const r = await client.callTool({ name: "abrir_link", arguments: { url: "javascript:alert(1)" } });
  assert.equal(r.isError, true);
});
