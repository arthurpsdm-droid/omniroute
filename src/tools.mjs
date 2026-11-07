// Ferramentas que o Claude pode usar no tablet.
//
// Um único catálogo serve aos dois caminhos de integração:
//   - o assistente do claude-tab (API do Claude + tool runner), e
//   - o servidor MCP usado pelo Claude Code rodando no Termux.
//
// Cada ferramenta devolve texto ou {text, image}. As marcadas como
// `sensivel` (câmera, tela, localização, área de transferência,
// notificações) pedem confirmação antes de rodar.

import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { run, runJson, TermuxError } from "./termux.mjs";
import { infoDispositivo } from "./device.mjs";
import { readImage, newestImage } from "./attachments.mjs";

const json = (v) => JSON.stringify(v, null, 2);

const FLUXOS_VOLUME = ["music", "ring", "notification", "alarm", "system", "call"];

function slug(s) {
  return (
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "nota"
  );
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function splitLanguage(tag) {
  const [lang, region] = tag.split(/[-_]/);
  return { lang: lang || "pt", region: region || "" };
}

/** Avisa a galeria/Meus Arquivos sobre um arquivo novo (falha silenciosa). */
async function mediaScan(file) {
  try {
    await run("termux-media-scan", [file], { timeoutMs: 10_000 });
  } catch {
    /* opcional */
  }
}

/** @type {Array<{name:string,title:string,description:string,input:Record<string, z.ZodTypeAny>,readOnly:boolean,sensitive?:(args:any)=>string,run:(args:any, ctx:any)=>Promise<string|{text:string,image?:{media_type:string,data:string}}>}>} */
export const TOOLS = [
  // ---------------------------------------------------------------- leitura
  {
    name: "info_tablet",
    title: "Informações do tablet",
    description:
      "Identifica o tablet (modelo da linha Galaxy Tab S10, versão do Android e do One UI) e a ficha técnica básica.",
    input: {},
    readOnly: true,
    run: async () => json(await infoDispositivo()),
  },
  {
    name: "bateria",
    title: "Bateria",
    description:
      "Lê o estado da bateria: porcentagem, se está carregando, temperatura, saúde e corrente.",
    input: {},
    readOnly: true,
    run: async () => json(await runJson("termux-battery-status")),
  },
  {
    name: "wifi",
    title: "Conexão Wi-Fi",
    description: "Mostra a rede Wi-Fi conectada, intensidade do sinal, velocidade do link e IP.",
    input: {},
    readOnly: true,
    run: async () => json(await runJson("termux-wifi-connectioninfo")),
  },
  {
    name: "sensores",
    title: "Sensores",
    description:
      "Sem argumentos: lista os sensores do tablet (acelerômetro, giroscópio, luz, etc.). " +
      "Com `sensor`: faz uma leitura desse sensor (use parte do nome, ex.: 'light' ou 'accelerometer').",
    input: {
      sensor: z.string().min(1).optional().describe("Nome (ou parte do nome) do sensor a ler"),
    },
    readOnly: true,
    run: async ({ sensor }) => {
      if (!sensor) return json(await runJson("termux-sensor", ["-l"], { timeoutMs: 15_000 }));
      // -n 1 = uma única leitura
      const out = await run("termux-sensor", ["-s", sensor, "-n", "1"], { timeoutMs: 15_000 });
      return out.trim() || `Nenhuma leitura do sensor "${sensor}".`;
    },
  },
  {
    name: "volume",
    title: "Volume",
    description:
      "Sem `nivel_percentual`: lista o volume atual de cada fluxo de áudio. " +
      "Com `fluxo` e `nivel_percentual` (0–100): ajusta o volume daquele fluxo.",
    input: {
      fluxo: z.enum(FLUXOS_VOLUME).optional().describe("music, ring, notification, alarm, system ou call"),
      nivel_percentual: z.number().int().min(0).max(100).optional(),
    },
    readOnly: false,
    run: async ({ fluxo, nivel_percentual }) => {
      const atuais = await runJson("termux-volume");
      if (nivel_percentual === undefined) return json(atuais);
      const alvo = fluxo ?? "music";
      const info = Array.isArray(atuais) ? atuais.find((s) => s.stream === alvo) : null;
      const max = info?.max_volume ?? 15;
      const valor = Math.round((nivel_percentual / 100) * max);
      await run("termux-volume", [alvo, String(valor)]);
      return `Volume de "${alvo}" ajustado para ${valor}/${max} (${nivel_percentual}%).`;
    },
  },

  // ---------------------------------------------------------------- ações
  {
    name: "ajustar_brilho",
    title: "Brilho da tela",
    description:
      "Ajusta o brilho da tela em porcentagem (0–100) ou liga o brilho automático. " +
      "Exige que o Termux:API tenha a permissão 'Modificar configurações do sistema'.",
    input: {
      percentual: z.number().int().min(0).max(100).optional(),
      automatico: z.boolean().optional().describe("true para brilho automático"),
    },
    readOnly: false,
    run: async ({ percentual, automatico }) => {
      if (automatico) {
        await run("termux-brightness", ["auto"]);
        return "Brilho automático ativado.";
      }
      if (percentual === undefined) throw new TermuxError("Informe `percentual` ou `automatico: true`.");
      const valor = Math.round((percentual / 100) * 255);
      await run("termux-brightness", [String(valor)]);
      return `Brilho ajustado para ${percentual}%.`;
    },
  },
  {
    name: "lanterna",
    title: "Lanterna",
    description: "Liga ou desliga o flash LED da câmera traseira.",
    input: { ligar: z.boolean() },
    readOnly: false,
    run: async ({ ligar }) => {
      await run("termux-torch", [ligar ? "on" : "off"]);
      return ligar ? "Lanterna ligada." : "Lanterna desligada.";
    },
  },
  {
    name: "notificar",
    title: "Notificação",
    description:
      "Mostra uma notificação no tablet (útil para lembretes rápidos ou para deixar um resultado à mão). " +
      "Use o mesmo `id` para substituir uma notificação anterior.",
    input: {
      titulo: z.string().min(1).max(200),
      texto: z.string().min(1).max(4000),
      id: z.string().max(64).optional(),
    },
    readOnly: false,
    run: async ({ titulo, texto, id }) => {
      const args = ["--title", titulo, "--content", texto, "--group", "claude-tab"];
      if (id) args.push("--id", id);
      await run("termux-notification", args);
      return "Notificação exibida.";
    },
  },
  {
    name: "aviso_na_tela",
    title: "Aviso rápido",
    description: "Mostra um aviso curto (toast) na tela por alguns segundos.",
    input: { texto: z.string().min(1).max(300) },
    readOnly: false,
    run: async ({ texto }) => {
      await run("termux-toast", ["-g", "top"], { input: texto });
      return "Aviso exibido.";
    },
  },
  {
    name: "falar",
    title: "Falar em voz alta",
    description: "Lê um texto em voz alta com o sintetizador de voz do tablet.",
    input: { texto: z.string().min(1).max(4000) },
    readOnly: false,
    run: async ({ texto }, ctx) => {
      await falar(texto, ctx.settings.language);
      return "Texto falado.";
    },
  },
  {
    name: "abrir_link",
    title: "Abrir link",
    description:
      "Abre um endereço no app padrão: páginas web (https://), mapas (geo:) ou e-mail (mailto:).",
    input: { url: z.string().min(4).max(2000) },
    readOnly: false,
    run: async ({ url }) => {
      if (!/^(https?:\/\/|geo:|mailto:)/i.test(url)) {
        throw new TermuxError("Só abro links https://, http://, geo: ou mailto:.");
      }
      await run("termux-open-url", [url]);
      return `Abrindo ${url}`;
    },
  },
  {
    name: "copiar_texto",
    title: "Copiar para a área de transferência",
    description: "Coloca um texto na área de transferência do tablet (para colar em qualquer app).",
    input: { texto: z.string().min(1).max(100_000) },
    readOnly: false,
    run: async ({ texto }) => {
      await run("termux-clipboard-set", [], { input: texto });
      return "Texto copiado para a área de transferência.";
    },
  },
  {
    name: "compartilhar_texto",
    title: "Compartilhar texto",
    description:
      "Abre a folha 'Compartilhar' do Android com um texto, para o usuário escolher o app de destino " +
      "(Samsung Notes, WhatsApp, Gmail…). O usuário confirma o envio no próprio app.",
    input: {
      texto: z.string().min(1).max(100_000),
      titulo: z.string().max(200).optional(),
    },
    readOnly: false,
    run: async ({ texto, titulo }) => {
      const args = ["-a", "send", "-c", "text/plain"];
      if (titulo) args.push("-t", titulo);
      await run("termux-share", args, { input: texto, timeoutMs: 60_000 });
      return "Folha de compartilhamento aberta.";
    },
  },
  {
    name: "salvar_nota",
    title: "Salvar nota",
    description:
      "Salva um texto (Markdown) como arquivo em Documentos/Claude no armazenamento interno, " +
      "visível no app Meus Arquivos. Devolve o caminho do arquivo.",
    input: {
      titulo: z.string().min(1).max(120),
      conteudo: z.string().min(1).max(500_000),
    },
    readOnly: false,
    run: async ({ titulo, conteudo }, ctx) => {
      const dir = ctx.settings.notesDir;
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, `${stamp()}-${slug(titulo)}.md`);
      await fs.writeFile(file, `# ${titulo}\n\n${conteudo}\n`, "utf8");
      await mediaScan(file);
      return `Nota salva em ${file}`;
    },
  },
  {
    name: "perguntar_ao_usuario",
    title: "Perguntar ao usuário",
    description:
      "Abre uma caixa de texto na tela para o usuário digitar (ou ditar) uma resposta. " +
      "Use quando faltar uma informação para concluir a tarefa.",
    input: { pergunta: z.string().min(1).max(300) },
    readOnly: true,
    run: async ({ pergunta }) => {
      const r = await runJson("termux-dialog", ["text", "-t", pergunta], { timeoutMs: 300_000 });
      if (!r || r.code !== -1 || !r.text) return "O usuário não respondeu (cancelou).";
      return `Resposta do usuário: ${r.text}`;
    },
  },

  // ---------------------------------------------------- sensíveis (confirmação)
  {
    name: "ler_area_de_transferencia",
    title: "Ler área de transferência",
    description: "Lê o texto que está na área de transferência do tablet.",
    input: {},
    readOnly: true,
    sensitive: () => "ler o texto da sua área de transferência",
    run: async () => {
      const t = await run("termux-clipboard-get");
      return t.trim() ? t : "A área de transferência está vazia.";
    },
  },
  {
    name: "ultima_captura_de_tela",
    title: "Última captura de tela",
    description:
      "Pega a captura de tela mais recente do tablet (pasta Screenshots) para você ver a imagem. " +
      "Útil quando o usuário pede ajuda com algo que está na tela.",
    input: {},
    readOnly: true,
    sensitive: () => "ver sua captura de tela mais recente",
    run: async (_args, ctx) => {
      const found = await newestImage(ctx.settings.screenshotDirs);
      if (!found) {
        return (
          "Não encontrei capturas de tela. Tire uma (botão lateral + diminuir volume, ou deslize a palma) " +
          "e confirme que o Termux tem acesso ao armazenamento (termux-setup-storage)."
        );
      }
      const minutos = Math.round((Date.now() - found.mtimeMs) / 60000);
      return {
        text: `Captura ${path.basename(found.file)} (de ${minutos} min atrás).`,
        image: await readImage(found.file),
      };
    },
  },
  {
    name: "tirar_foto",
    title: "Tirar foto",
    description:
      "Tira uma foto com a câmera traseira ou frontal e devolve a imagem para você analisar. " +
      "A foto fica salva em Imagens/Claude.",
    input: { camera: z.enum(["traseira", "frontal"]).default("traseira") },
    readOnly: false,
    sensitive: ({ camera }) => `tirar uma foto com a câmera ${camera ?? "traseira"}`,
    run: async ({ camera = "traseira" }, ctx) => {
      const dir = ctx.settings.photosDir;
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, `foto-${stamp()}.jpg`);
      await run("termux-camera-photo", ["-c", camera === "frontal" ? "1" : "0", file], {
        timeoutMs: 30_000,
      });
      await mediaScan(file);
      return { text: `Foto salva em ${file}.`, image: await readImage(file) };
    },
  },
  {
    name: "localizacao",
    title: "Localização",
    description:
      "Obtém a localização aproximada do tablet (latitude/longitude). 'rede' é rápido; 'gps' é mais preciso " +
      "mas pode demorar e só funciona ao ar livre (o Tab S10 5G tem GPS; nos modelos Wi-Fi use 'rede').",
    input: { precisao: z.enum(["rede", "gps"]).default("rede") },
    readOnly: true,
    sensitive: () => "acessar sua localização",
    run: async ({ precisao = "rede" }) =>
      json(
        await runJson("termux-location", ["-p", precisao === "gps" ? "gps" : "network", "-r", "once"], {
          timeoutMs: 90_000,
        }),
      ),
  },
  {
    name: "notificacoes_recentes",
    title: "Notificações recentes",
    description:
      "Lista as notificações atuais do tablet (app, título, texto). Requer acesso a notificações " +
      "concedido ao Termux:API.",
    input: {},
    readOnly: true,
    sensitive: () => "ler as notificações do tablet",
    run: async () => {
      const list = (await runJson("termux-notification-list", [], { timeoutMs: 20_000 })) ?? [];
      const slim = list.map(({ packageName, title, content, when }) => ({ app: packageName, title, content, when }));
      return json(slim);
    },
  },
];

/** Fala um texto com o TTS do Android. */
export async function falar(texto, language = "pt-BR") {
  const { lang, region } = splitLanguage(language);
  const args = ["-l", lang];
  if (region) args.push("-n", region);
  // tempo proporcional ao tamanho do texto (o comando espera terminar de falar)
  await run("termux-tts-speak", args, { input: texto, timeoutMs: 30_000 + texto.length * 120 });
}

/**
 * Ouve uma fala com o reconhecimento de voz do Android (idioma do sistema) e
 * devolve o texto, ou "" se ninguém falou.
 */
export async function ouvir() {
  const out = await run("termux-speech-to-text", [], { timeoutMs: 60_000 });
  // O reconhecedor pode imprimir resultados parciais, um por linha; o último é o mais completo.
  const linhas = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return linhas.at(-1) ?? "";
}

export function getTool(name) {
  return TOOLS.find((t) => t.name === name);
}

/**
 * Executa uma ferramenta: valida a entrada, pede confirmação se for sensível e
 * captura erros para devolvê-los ao modelo como texto.
 * @returns {Promise<{ok:boolean, text:string, image?:{media_type:string,data:string}}>}
 */
export async function executeTool(tool, rawArgs, ctx) {
  const parsed = z.object(tool.input).safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return { ok: false, text: `Entrada inválida para ${tool.name}: ${parsed.error.message}` };
  }
  const args = parsed.data;
  try {
    if (tool.sensitive && ctx.confirmMode !== "nenhum") {
      const ok = await ctx.confirm(`O Claude quer ${tool.sensitive(args)}.`);
      if (!ok) return { ok: false, text: "O usuário NÃO autorizou esta ação. Não tente de novo sem perguntar." };
    }
    const out = await tool.run(args, ctx);
    if (typeof out === "string") return { ok: true, text: out };
    return { ok: true, text: out.text, image: out.image };
  } catch (err) {
    return { ok: false, text: err instanceof Error ? err.message : String(err) };
  }
}
