// Entrega das respostas: arquivo da última resposta e notificação com botões.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { run } from "./termux.mjs";

export const CACHE_DIR = path.join(os.homedir(), ".cache", "claude-tab");
export const RESPOSTA_FILE = path.join(CACHE_DIR, "ultima-resposta.md");

/** Pasta dos executáveis do Termux (usada nas ações dos botões de notificação). */
export function binTermux() {
  return `${process.env.PREFIX || "/data/data/com.termux/files/usr"}/bin`;
}

export async function salvarResposta(texto) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(RESPOSTA_FILE, texto, "utf8");
}

/** Notificação com a resposta e os botões Copiar e Compartilhar. */
export async function notificarResposta(texto, { titulo = "Claude" } = {}) {
  await salvarResposta(texto);
  const bin = binTermux();
  const q = JSON.stringify(RESPOSTA_FILE);
  await run("termux-notification", [
    "--id", "claude-tab-resposta",
    "--group", "claude-tab",
    "--title", titulo,
    "--content", texto.length > 3500 ? `${texto.slice(0, 3500)}…` : texto,
    "--button1", "Copiar",
    "--button1-action", `${bin}/termux-clipboard-set < ${q}`,
    "--button2", "Compartilhar",
    "--button2-action", `${bin}/termux-share -a send ${q}`,
  ]);
}

/** Aviso curto na tela; nunca falha. */
export async function aviso(texto) {
  await run("termux-toast", ["-s", "-g", "top"], { input: texto }).catch(() => {});
}
