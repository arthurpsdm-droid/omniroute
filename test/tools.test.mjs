import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { sandbox, useSandboxEnv } from "./helpers.mjs";
import { identificarModelo, versaoOneUI, infoDispositivo } from "../src/device.mjs";
import { TOOLS, getTool, executeTool } from "../src/tools.mjs";
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

function ctx(overrides = {}) {
  return {
    settings: {
      ...settings(),
      language: "pt-BR",
      notesDir: path.join(sb.dir, "notas"),
      photosDir: path.join(sb.dir, "fotos"),
      screenshotDirs: [path.join(sb.dir, "Screenshots")],
    },
    confirmMode: "dialogo",
    confirm: async () => true,
    ...overrides,
  };
}

test("identifica cada modelo da linha Tab S10 pelo número do modelo", () => {
  assert.equal(identificarModelo("SM-X920").nome, "Galaxy Tab S10 Ultra");
  assert.equal(identificarModelo("SM-X926B").nome, "Galaxy Tab S10 Ultra");
  assert.equal(identificarModelo("sm-x820").nome, "Galaxy Tab S10+");
  assert.equal(identificarModelo("SM-X520").nome, "Galaxy Tab S10 FE");
  assert.equal(identificarModelo("SM-X626B").nome, "Galaxy Tab S10 FE+");
  assert.equal(identificarModelo("SM-X400").nome, "Galaxy Tab S10 Lite");
  assert.equal(identificarModelo("SM-S928B"), null);
});

test("decodifica a versão do One UI", () => {
  assert.equal(versaoOneUI("80500"), "8.5");
  assert.equal(versaoOneUI("60100"), "6.1");
  assert.equal(versaoOneUI(""), null);
});

test("infoDispositivo lê as propriedades do sistema", async () => {
  const info = await infoDispositivo();
  assert.equal(info.nome, "Galaxy Tab S10 Ultra");
  assert.equal(info.android, "16");
  assert.equal(info.one_ui, "8.5");
});

test("nomes de ferramentas são únicos e válidos para a API", () => {
  const names = TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const n of names) assert.match(n, /^[a-z0-9_]{1,64}$/);
});

test("bateria devolve o JSON do termux-battery-status", async () => {
  const r = await executeTool(getTool("bateria"), {}, ctx());
  assert.ok(r.ok);
  assert.equal(JSON.parse(r.text).percentage, 80);
});

test("volume converte porcentagem para a escala do fluxo", async () => {
  const r = await executeTool(getTool("volume"), { fluxo: "music", nivel_percentual: 60 }, ctx());
  assert.ok(r.ok, r.text);
  assert.match(sb.calls(), /CALL termux-volume music 9\n/);
});

test("brilho em porcentagem vira 0–255", async () => {
  const r = await executeTool(getTool("ajustar_brilho"), { percentual: 50 }, ctx());
  assert.ok(r.ok);
  assert.match(sb.calls(), /CALL termux-brightness 128\n/);
});

test("entrada inválida é recusada antes de rodar o comando", async () => {
  const r = await executeTool(getTool("ajustar_brilho"), { percentual: 150 }, ctx());
  assert.equal(r.ok, false);
  assert.match(r.text, /Entrada inválida/);
});

test("abrir_link recusa esquemas perigosos", async () => {
  const r = await executeTool(getTool("abrir_link"), { url: "intent://algo" }, ctx());
  assert.equal(r.ok, false);
});

test("ferramenta sensível não roda se o usuário negar", async () => {
  const before = sb.calls();
  const r = await executeTool(getTool("ler_area_de_transferencia"), {}, ctx({ confirm: async () => false }));
  assert.equal(r.ok, false);
  assert.match(r.text, /NÃO autorizou/);
  assert.equal(sb.calls().slice(before.length).includes("termux-clipboard-get"), false);
});

test("ferramenta sensível roda após confirmação", async () => {
  let pedido = "";
  const r = await executeTool(
    getTool("ler_area_de_transferencia"),
    {},
    ctx({ confirm: async (m) => ((pedido = m), true) }),
  );
  assert.ok(r.ok);
  assert.equal(r.text, "texto copiado");
  assert.match(pedido, /área de transferência/);
});

test("salvar_nota grava Markdown na pasta de notas", async () => {
  const r = await executeTool(getTool("salvar_nota"), { titulo: "Reunião de Ação", conteudo: "- item" }, ctx());
  assert.ok(r.ok, r.text);
  const file = r.text.replace("Nota salva em ", "");
  assert.match(path.basename(file), /reuniao-de-acao\.md$/);
  assert.equal(fs.readFileSync(file, "utf8"), "# Reunião de Ação\n\n- item\n");
});

test("ultima_captura_de_tela devolve a imagem mais recente", async () => {
  const c = ctx();
  const dir = c.settings.screenshotDirs[0];
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(sb.image, path.join(dir, "antiga.png"));
  fs.utimesSync(path.join(dir, "antiga.png"), new Date(2020, 0, 1), new Date(2020, 0, 1));
  fs.copyFileSync(sb.image, path.join(dir, "Screenshot_nova.png"));
  fs.writeFileSync(path.join(dir, "nota.txt"), "ignorar");
  const r = await executeTool(getTool("ultima_captura_de_tela"), {}, c);
  assert.ok(r.ok, r.text);
  assert.match(r.text, /Screenshot_nova\.png/);
  assert.equal(r.image.media_type, "image/png");
});

test("tirar_foto usa a câmera frontal com id 1 e devolve a imagem", async () => {
  const r = await executeTool(getTool("tirar_foto"), { camera: "frontal" }, ctx());
  assert.ok(r.ok, r.text);
  assert.match(sb.calls(), /CALL termux-camera-photo -c 1 .*foto-.*\.jpg/);
  assert.ok(r.image.data.length > 0);
});

test("falar envia o texto pelo stdin com idioma e região", async () => {
  const r = await executeTool(getTool("falar"), { texto: "Olá, tablet" }, ctx());
  assert.ok(r.ok);
  assert.match(sb.calls(), /CALL termux-tts-speak -l pt -n BR\nSTDIN Olá, tablet\n/);
});

test("comando ausente gera mensagem com a dica de instalação", async () => {
  const savedPath = process.env.PATH;
  process.env.PATH = "/nonexistent";
  try {
    const r = await executeTool(getTool("lanterna"), { ligar: true }, ctx());
    assert.equal(r.ok, false);
    assert.match(r.text, /pkg install termux-api/);
  } finally {
    process.env.PATH = savedPath;
  }
});
