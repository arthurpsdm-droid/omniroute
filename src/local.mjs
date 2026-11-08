// Comandos locais: pedidos simples ao tablet ("abaixa o brilho para 30",
// "liga a lanterna", "qual a bateria?") são entendidos aqui mesmo, sem chamar o
// Claude. Custo zero, resposta instantânea e funciona sem internet.
//
// Só reconhecemos frases curtas e diretas. Qualquer coisa ambígua ("o que é
// brilho em física?") segue para o Claude.

import { executeTool, getTool } from "./tools.mjs";

function normalizar(frase) {
  return frase
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[!?.,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const VERBO_AJUSTE =
  /^(?:por favor |claude )?(coloca|coloque|poe|ponha|deixa|deixe|ajusta|ajuste|muda|mude|abaixa|abaixe|baixa|baixe|diminui|diminua|aumenta|aumente|sobe|suba|bota|bote)\b/;

function numero(t) {
  const m = t.match(/\b(\d{1,3})\s*(?:%|por ?cento)?(?=\s|$)/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 100 ? n : null;
}

function nivel(t) {
  if (/\b(maximo|tudo|cem por cento)\b/.test(t)) return 100;
  if (/\b(minimo)\b/.test(t)) return 10;
  if (/\bmetade\b/.test(t)) return 50;
  return numero(t);
}

/**
 * Interpreta a frase. Devolve {tool, args, responder(resultado)} ou null.
 * @param {string} frase
 */
export function interpretarComando(frase) {
  const t = normalizar(frase);
  if (!t || t.split(" ").length > 10) return null;

  // Lanterna
  if (/\blanterna\b/.test(t)) {
    if (/\b(desliga|desligar|apaga|apagar|desativa)\b/.test(t)) {
      return { tool: "lanterna", args: { ligar: false }, responder: () => "Lanterna desligada." };
    }
    if (/\b(liga|ligar|acende|acender|ativa)\b/.test(t)) {
      return { tool: "lanterna", args: { ligar: true }, responder: () => "Lanterna ligada." };
    }
    return null;
  }

  // Brilho
  if (/\bbrilho\b/.test(t) && (VERBO_AJUSTE.test(t) || t.startsWith("brilho"))) {
    if (/\bautomatico\b/.test(t)) {
      return { tool: "ajustar_brilho", args: { automatico: true }, responder: () => "Brilho automático ligado." };
    }
    const n = nivel(t);
    if (n === null) return null;
    return { tool: "ajustar_brilho", args: { percentual: n }, responder: () => `Pronto, brilho em ${n}%.` };
  }

  // Volume
  if (/^(silencia|silenciar|muta|mutar|tira o som|sem som)\b/.test(t)) {
    return { tool: "volume", args: { fluxo: "music", nivel_percentual: 0 }, responder: () => "Som da mídia desligado." };
  }
  if (/\bvolume\b/.test(t) && (VERBO_AJUSTE.test(t) || t.startsWith("volume"))) {
    const n = nivel(t);
    if (n === null) return null;
    return {
      tool: "volume",
      args: { fluxo: "music", nivel_percentual: n },
      responder: () => `Volume da mídia em ${n}%.`,
    };
  }

  // Bateria
  if (/\bbateria\b/.test(t) && /^(qual|quanto|quanta|como|ta|esta|nivel|bateria|me diz|fala)\b/.test(t)) {
    return {
      tool: "bateria",
      args: {},
      responder: (r) => {
        const b = JSON.parse(r);
        const estado =
          b.status === "CHARGING" ? "e está carregando" : b.status === "FULL" ? "e está cheia" : "e não está carregando";
        return `A bateria está em ${b.percentage}% ${estado}.`;
      },
    };
  }

  // Wi-Fi
  if (/\b(wi[ -]?fi|uai fai|internet)\b/.test(t) && /^(qual|em que|em qual|to|estou|ta|esta|me diz)\b/.test(t)) {
    return {
      tool: "wifi",
      args: {},
      responder: (r) => {
        const w = JSON.parse(r);
        if (!w.ssid || /unknown/i.test(w.ssid)) return "Não estou conectado a nenhuma rede Wi-Fi.";
        return `Você está na rede ${w.ssid.replace(/^"|"$/g, "")}.`;
      },
    };
  }

  return null;
}

/**
 * Tenta resolver a frase localmente. Devolve o texto da resposta, ou null se a
 * frase precisa do Claude.
 * @param {string} frase
 * @param {{settings: object, confirmMode?: string, confirm?: (m:string)=>Promise<boolean>}} ctx
 */
export async function executarLocal(frase, ctx) {
  if (!ctx.settings.localCommands) return null;
  const cmd = interpretarComando(frase);
  if (!cmd) return null;
  const r = await executeTool(getTool(cmd.tool), cmd.args, { confirmMode: "nenhum", confirm: async () => true, ...ctx });
  if (!r.ok) return `Não consegui: ${r.text}`;
  try {
    return cmd.responder(r.text);
  } catch {
    return r.text;
  }
}
