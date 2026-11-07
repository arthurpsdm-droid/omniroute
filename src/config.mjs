// Configuração do claude-tab.
//
// Os atalhos do Termux:Widget e o menu "Compartilhar" rodam fora de um shell
// interativo (não leem ~/.bashrc), então a chave da API e as preferências ficam
// num arquivo próprio: ~/.config/claude-tab/env (criado pelo install.sh com
// permissão 600). Variáveis já definidas no ambiente têm prioridade.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CONFIG_DIR =
  process.env.CLAUDE_TAB_CONFIG_DIR ?? path.join(os.homedir(), ".config", "claude-tab");
export const ENV_FILE = path.join(CONFIG_DIR, "env");

/** Lê linhas CHAVE=valor (aceita `export` e aspas) sem sobrescrever o ambiente. */
export function loadEnvFile(file = ENV_FILE) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return false;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let [, key, value] = m;
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}

const SHARED = path.join(os.homedir(), "storage", "shared");

export function settings() {
  const env = process.env;
  return {
    // Modelo e esforço de raciocínio. "low" deixa a voz mais ágil.
    model: env.CLAUDE_TAB_MODELO || "claude-opus-5-5",
    effort: env.CLAUDE_TAB_ESFORCO || "medium",
    voiceEffort: env.CLAUDE_TAB_ESFORCO_VOZ || "low",
    studyEffort: env.CLAUDE_TAB_ESFORCO_ESTUDO || "low",
    // Palavras que "acordam" o Claude no modo estudo com escuta. Inclui grafias
    // que o reconhecimento de voz costuma produzir para "Claude".
    wakeWords: (env.CLAUDE_TAB_PALAVRAS_ATIVACAO || "claude,claud,clode,cloud,claudio")
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean),
    // Idioma da fala (TTS) e do reconhecimento de voz.
    language: env.CLAUDE_TAB_IDIOMA || "pt-BR",
    // Como confirmar ações sensíveis (câmera, localização, tela, área de
    // transferência): "dialogo" (Sim/Não na tela), "digital" (impressão
    // digital do tablet) ou "nenhum".
    confirm: env.CLAUDE_TAB_CONFIRMAR || "dialogo",
    // Busca e leitura de páginas na web (ferramentas do lado do servidor).
    web: env.CLAUDE_TAB_WEB !== "0",
    // Fallback automático do servidor quando um pedido é recusado.
    fallback: env.CLAUDE_TAB_FALLBACK !== "0",
    maxIterations: Number(env.CLAUDE_TAB_MAX_ITERACOES || 12),
    // Pastas no armazenamento interno (após `termux-setup-storage`).
    notesDir: env.CLAUDE_TAB_PASTA_NOTAS || path.join(SHARED, "Documents", "Claude"),
    photosDir: env.CLAUDE_TAB_PASTA_FOTOS || path.join(SHARED, "Pictures", "Claude"),
    screenshotDirs: (env.CLAUDE_TAB_PASTAS_CAPTURAS
      ? env.CLAUDE_TAB_PASTAS_CAPTURAS.split(":")
      : [
          path.join(SHARED, "DCIM", "Screenshots"),
          path.join(SHARED, "Pictures", "Screenshots"),
        ]
    ).filter(Boolean),
  };
}
