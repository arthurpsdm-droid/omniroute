import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sandbox, useSandboxEnv, fakeApi, allText } from "./helpers.mjs";
import { Conversa, createClient, pendingToolResults, textOf } from "../src/claude.mjs";
import { settings } from "../src/config.mjs";

let sb, restore;
before(() => {
  sb = sandbox();
  restore = useSandboxEnv(sb);
});
after(() => {
  restore();
  sb.cleanup();
});

const thinking = (sig) => ({ type: "thinking", thinking: "", signature: sig });

test("executa a ferramenta pedida pelo Claude e devolve a resposta final", async () => {
  const api = await fakeApi((body, n) =>
    n === 1
      ? { stop_reason: "tool_use", content: [thinking("s1"), { type: "tool_use", id: "tu_1", name: "bateria", input: {} }] }
      : { content: [thinking("s2"), { type: "text", text: "A bateria está em 80%." }] },
  );
  try {
    const usadas = [];
    const conversa = new Conversa({
      client: createClient({ baseURL: api.url, apiKey: "sk-ant-teste" }),
      settings: { ...settings(), web: true },
      onToolCall: (t) => usadas.push(t.name),
    });
    const r = await conversa.enviar("Como está a bateria?");
    assert.equal(r.text, "A bateria está em 80%.");
    assert.deepEqual(usadas, ["bateria"]);

    const [primeira, segunda] = api.requests;
    assert.equal(primeira.url, "/v1/messages");
    assert.equal(primeira.body.model, "claude-opus-5-5");
    assert.equal(primeira.body.output_config.effort, "medium");
    assert.equal(primeira.body.fallbacks, "default");
    assert.match(primeira.headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
    assert.equal(primeira.body.max_iterations, undefined, "configuração do runner não vai para a API");
    const nomes = primeira.body.tools.map((t) => t.name);
    assert.ok(nomes.includes("bateria") && nomes.includes("web_search") && nomes.includes("web_fetch"));
    // a segunda requisição leva o resultado real da ferramenta
    assert.match(allText(segunda.body), /"percentage": 80/);
  } finally {
    await api.close();
  }
});

test("o histórico só cresce entre turnos e preserva os blocos de raciocínio", async () => {
  const api = await fakeApi((body, n) => ({ content: [thinking(`s${n}`), { type: "text", text: `resposta ${n}` }] }));
  try {
    const conversa = new Conversa({
      client: createClient({ baseURL: api.url, apiKey: "sk-ant-teste" }),
      settings: { ...settings(), web: false },
      voz: true,
    });
    await conversa.enviar("primeira");
    const depois1 = structuredClone(conversa.messages);
    const r2 = await conversa.enviar("segunda");
    assert.equal(r2.text, "resposta 2");
    // prefixo idêntico: nada foi editado
    assert.deepEqual(conversa.messages.slice(0, depois1.length), depois1);
    assert.equal(conversa.messages.length, 4);
    const enviado = api.requests[1].body.messages;
    assert.deepEqual(enviado[1].content[0], thinking("s1"));
    // modo voz usa o prompt de voz e o esforço baixo
    assert.match(JSON.stringify(api.requests[1].body.system), /MODO VOZ/);
    assert.equal(api.requests[1].body.output_config.effort, "low");
    assert.equal(api.requests[1].body.tools.some((t) => t.name === "web_search"), false);
  } finally {
    await api.close();
  }
});

test("recusa do modelo vira mensagem clara", async () => {
  const api = await fakeApi(() => ({
    stop_reason: "refusal",
    stop_details: { type: "refusal", category: "cyber", explanation: null },
    content: [],
  }));
  try {
    const conversa = new Conversa({
      client: createClient({ baseURL: api.url, apiKey: "sk-ant-teste" }),
      settings: settings(),
      ferramentas: false,
    });
    const r = await conversa.enviar("algo");
    assert.match(r.text, /não pôde atender.*cyber/);
    assert.equal(api.requests[0].body.tools, undefined);
  } finally {
    await api.close();
  }
});

test("chamadas de ferramenta pendentes recebem tool_result antes da nova pergunta", () => {
  const msgs = [
    { role: "user", content: "oi" },
    { role: "assistant", content: [thinking("x"), { type: "tool_use", id: "tu_9", name: "bateria", input: {} }] },
  ];
  const pend = pendingToolResults(msgs);
  assert.equal(pend.length, 1);
  assert.equal(pend[0].tool_use_id, "tu_9");
  assert.equal(pend[0].is_error, true);
  assert.deepEqual(pendingToolResults([{ role: "user", content: "oi" }]), []);
});

test("textOf junta só os blocos de texto", () => {
  assert.equal(
    textOf({ content: [thinking("a"), { type: "text", text: "Olá " }, { type: "text", text: "mundo" }] }),
    "Olá mundo",
  );
});
