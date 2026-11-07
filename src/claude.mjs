// Cliente do Claude para o tablet: conversa com histórico, ferramentas do
// tablet (via tool runner do SDK) e busca/leitura na web.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { TOOLS, executeTool } from "./tools.mjs";
import { confirmar } from "./termux.mjs";

export const SYSTEM_BASE = `Você é o Claude, assistente da Anthropic, rodando no tablet Samsung Galaxy Tab S10 do usuário através do Termux (integração "claude-tab").

- Responda em português do Brasil, a menos que o usuário use outro idioma.
- Você tem ferramentas para agir no tablet (bateria, brilho, volume, lanterna, notificações, área de transferência, fala, câmera, captura de tela, notas, compartilhar). Use-as quando o pedido envolver o tablet; não as use sem necessidade.
- Algumas ferramentas pedem autorização na tela. Se o usuário negar, respeite e explique o que não foi possível fazer.
- Para resultados longos que o usuário vai querer guardar, ofereça salvar como nota ou compartilhar (ex.: Samsung Notes) em vez de despejar tudo na tela.
- Se precisar de uma informação que só o usuário tem, use perguntar_ao_usuario.`;

export const SYSTEM_VOZ = `${SYSTEM_BASE}

MODO VOZ: sua resposta será lida em voz alta pelo tablet.
- Frases curtas e naturais, como numa conversa. Sem Markdown, sem listas, sem emojis, sem links longos.
- Vá direto ao ponto: de uma a quatro frases, salvo se o usuário pedir detalhes.
- Ao executar uma ação no tablet, confirme em poucas palavras o que fez.`;

/** Lê ANTHROPIC_API_KEY (ou o perfil do `ant auth login`) e cria o cliente. */
export function createClient(opts = {}) {
  return new Anthropic(opts);
}

/** Converte o catálogo de ferramentas em ferramentas executáveis do tool runner. */
export function runnableTools(ctx) {
  return TOOLS.map((tool) =>
    betaZodTool({
      name: tool.name,
      description: tool.description,
      inputSchema: z.object(tool.input),
      run: async (args) => {
        ctx.onToolCall?.(tool, args);
        const r = await executeTool(tool, args, ctx);
        if (!r.ok) throw new Error(r.text); // vira tool_result com is_error: true
        if (!r.image) return r.text;
        return [
          { type: "text", text: r.text },
          { type: "image", source: { type: "base64", media_type: r.image.media_type, data: r.image.data } },
        ];
      },
    }),
  );
}

/** Ferramentas executadas nos servidores da Anthropic (sem código local). */
export const WEB_TOOLS = [
  { type: "web_search_20260209", name: "web_search", max_uses: 5 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5 },
];

/** Junta os blocos de texto da resposta final. */
export function textOf(message) {
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/** Explica erros da API em português, com a ação para resolver. */
export function explainError(err) {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Chave da API inválida ou ausente. Rode \"claude-tab configurar\" e cole a sua chave (console.anthropic.com).";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return `Sem permissão para este recurso na sua conta da API: ${err.message}`;
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Limite de uso da API atingido. Espere um pouco e tente de novo.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    return `Pedido recusado pela API (400): ${err.message}`;
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Não consegui falar com a API do Claude. O tablet está conectado à internet?";
  }
  if (err instanceof Anthropic.APIError) {
    return `Erro da API (${err.status ?? "?"}): ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Se a rodada anterior parou no limite de etapas, a última mensagem do
 * assistente tem chamadas de ferramenta sem resposta. A API exige um
 * tool_result para cada uma, então respondemos "interrompido" antes da nova
 * pergunta (sem editar o histórico).
 */
export function pendingToolResults(messages) {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant" || !Array.isArray(last.content)) return [];
  return last.content
    .filter((b) => b.type === "tool_use")
    .map((b) => ({
      type: "tool_result",
      tool_use_id: b.id,
      is_error: true,
      content: "Interrompido: limite de etapas atingido antes de executar esta ferramenta.",
    }));
}

/**
 * Conversa com histórico. O histórico só cresce (nada é editado ou removido),
 * como a API exige para manter válidos os blocos de raciocínio do modelo.
 */
export class Conversa {
  /**
   * @param {{client?: Anthropic, settings: ReturnType<import("./config.mjs").settings>,
   *          voz?: boolean, ferramentas?: boolean, onToolCall?: (tool:any, args:any)=>void,
   *          confirm?: (msg:string)=>Promise<boolean>}} opts
   */
  constructor({ client, settings, voz = false, ferramentas = true, onToolCall, confirm, system, effort }) {
    this.client = client ?? createClient();
    this.settings = settings;
    this.voz = voz;
    // Instruções e esforço ficam fixos durante a conversa (mudar no meio invalida o cache).
    this.system = system ?? (voz ? SYSTEM_VOZ : SYSTEM_BASE);
    this.effort = effort ?? (voz ? settings.voiceEffort : settings.effort);
    this.messages = [];
    const ctx = {
      settings,
      confirmMode: settings.confirm,
      confirm: confirm ?? ((msg) => confirmar(msg, settings.confirm)),
      onToolCall,
    };
    this.tools = ferramentas ? [...runnableTools(ctx), ...(settings.web ? WEB_TOOLS : [])] : [];
  }

  /**
   * Envia uma mensagem (texto ou blocos) e devolve a resposta final.
   * @param {string | Array<object>} content
   * @returns {Promise<{text: string, message: object}>}
   */
  async enviar(content) {
    const { settings } = this;
    const pending = pendingToolResults(this.messages);
    if (pending.length) {
      const blocks = typeof content === "string" ? [{ type: "text", text: content }] : content;
      content = [...pending, ...blocks];
    }
    const params = {
      model: settings.model,
      max_tokens: 16000,
      system: this.system,
      cache_control: { type: "ephemeral" },
      output_config: { effort: this.effort },
      messages: [...this.messages, { role: "user", content }],
      max_iterations: settings.maxIterations,
    };
    if (this.tools.length) params.tools = this.tools;
    if (settings.fallback) {
      // Se um classificador de segurança recusar, o servidor tenta de novo no
      // modelo recomendado para aquela categoria.
      params.betas = ["server-side-fallback-2026-07-01"];
      params.fallbacks = "default";
    }

    const runner = this.client.beta.messages.toolRunner(params);
    const final = await runner.runUntilDone();
    this.messages = runner.params.messages;

    if (final.stop_reason === "refusal") {
      const cat = final.stop_details?.category;
      return {
        text: `O Claude não pôde atender a este pedido${cat ? ` (categoria: ${cat})` : ""}.`,
        message: final,
      };
    }
    let text = textOf(final);
    if (final.stop_reason === "max_tokens") text += "\n\n[resposta cortada por tamanho]";
    if (final.stop_reason === "tool_use") text += "\n\n[parei no limite de etapas; peça para continuar]";
    return { text: text || "(sem resposta em texto)", message: final };
  }
}
