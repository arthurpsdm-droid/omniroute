import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sandbox, useSandboxEnv } from "./helpers.mjs";
import { interpretarComando, executarLocal } from "../src/local.mjs";
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

const cmd = (f) => {
  const c = interpretarComando(f);
  return c && { tool: c.tool, args: c.args };
};

test("entende comandos diretos de brilho, volume e lanterna", () => {
  assert.deepEqual(cmd("Abaixa o brilho para 30 por cento"), { tool: "ajustar_brilho", args: { percentual: 30 } });
  assert.deepEqual(cmd("coloca o brilho em 70%"), { tool: "ajustar_brilho", args: { percentual: 70 } });
  assert.deepEqual(cmd("brilho no máximo"), { tool: "ajustar_brilho", args: { percentual: 100 } });
  assert.deepEqual(cmd("deixa o brilho automático"), { tool: "ajustar_brilho", args: { automatico: true } });
  assert.deepEqual(cmd("volume 40"), { tool: "volume", args: { fluxo: "music", nivel_percentual: 40 } });
  assert.deepEqual(cmd("silencia"), { tool: "volume", args: { fluxo: "music", nivel_percentual: 0 } });
  assert.deepEqual(cmd("liga a lanterna"), { tool: "lanterna", args: { ligar: true } });
  assert.deepEqual(cmd("desliga a lanterna, por favor"), { tool: "lanterna", args: { ligar: false } });
  assert.deepEqual(cmd("Qual a bateria?"), { tool: "bateria", args: {} });
  assert.deepEqual(cmd("como tá a bateria"), { tool: "bateria", args: {} });
  assert.deepEqual(cmd("em que wi-fi eu estou"), { tool: "wifi", args: {} });
});

test("perguntas de verdade continuam indo para o Claude", () => {
  assert.equal(interpretarComando("o que é brilho em física?"), null);
  assert.equal(interpretarComando("aumenta o brilho"), null); // sem valor: deixa o Claude decidir
  assert.equal(interpretarComando("a bateria de lítio funciona como?"), null);
  assert.equal(interpretarComando("me explica por que o volume de um gás aumenta com a temperatura"), null);
  assert.equal(interpretarComando("qual a capital da França"), null);
});

test("executa no tablet e responde em português", async () => {
  const s = settings();
  assert.equal(await executarLocal("qual a bateria", { settings: s }), "A bateria está em 80% e não está carregando.");
  assert.equal(await executarLocal("em que wifi estou", { settings: s }), "Você está na rede CasaWiFi.");
  assert.equal(await executarLocal("liga a lanterna", { settings: s }), "Lanterna ligada.");
  assert.match(sb.calls(), /CALL termux-torch on/);
  assert.equal(await executarLocal("qual a bateria", { settings: { ...s, localCommands: false } }), null);
});
