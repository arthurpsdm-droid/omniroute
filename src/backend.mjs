// Escolhe quem responde: a API (cobrança por uso) ou o Claude Code logado na
// sua assinatura (sem custo por resposta). Veja docs/03-sem-custo-por-resposta.md.

import { Conversa } from "./claude.mjs";
import { ConversaClaudeCode } from "./claude-code.mjs";

/** Cria a conversa conforme CLAUDE_TAB_BACKEND ("api" ou "claude-code"). */
export function criarConversa(opts) {
  return opts.settings.backend === "claude-code" ? new ConversaClaudeCode(opts) : new Conversa(opts);
}

/** Descrição curta do modo de cobrança, para o diagnóstico. */
export function descreverBackend(settings) {
  return settings.backend === "claude-code"
    ? "assinatura (Claude Code): sem custo por resposta, usa os limites do seu plano"
    : "API: cobrança por uso, alguns centavos por resposta";
}
