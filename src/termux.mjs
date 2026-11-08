// Execução dos comandos do Termux:API (termux-battery-status, termux-tts-speak…).
//
// Cada comando conversa com o app Termux:API. Se o app não estiver instalado
// ou sem permissão, alguns comandos ficam esperando para sempre — por isso
// todo comando tem tempo limite.

import { spawn } from "node:child_process";
import fs from "node:fs";

// Dentro do Ubuntu do proot-distro (onde roda o Claude Code) o PATH não inclui
// os comandos do Termux; acrescentamos a pasta deles no fim do PATH.
const TERMUX_BIN = "/data/data/com.termux/files/usr/bin";
if (fs.existsSync(TERMUX_BIN) && !(process.env.PATH ?? "").split(":").includes(TERMUX_BIN)) {
  process.env.PATH = `${process.env.PATH ?? ""}:${TERMUX_BIN}`;
}

export class TermuxError extends Error {
  constructor(message, { command } = {}) {
    super(message);
    this.name = "TermuxError";
    this.command = command;
  }
}

function notFoundHint(cmd) {
  if (cmd.startsWith("termux-")) {
    return (
      `O comando "${cmd}" não foi encontrado. No Termux rode "pkg install termux-api" ` +
      `e instale também o app Termux:API (da mesma loja de onde veio o Termux, ex.: F-Droid).`
    );
  }
  return `O comando "${cmd}" não foi encontrado no PATH.`;
}

/**
 * Roda um comando e devolve o stdout como texto.
 * @param {string} cmd
 * @param {string[]} [args]
 * @param {{input?: string, timeoutMs?: number, env?: NodeJS.ProcessEnv}} [opts]
 */
export function run(cmd, args = [], { input, timeoutMs = 30_000, env } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], env: env ?? process.env });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(
        reject,
        new TermuxError(
          `"${cmd}" não respondeu em ${Math.round(timeoutMs / 1000)} s. ` +
            `Confira se o app Termux:API está instalado e com as permissões concedidas.`,
          { command: cmd },
        ),
      );
    }, timeoutMs);

    child.stdout.setEncoding("utf8").on("data", (d) => (out += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (err += d));
    child.on("error", (e) => {
      finish(
        reject,
        new TermuxError(e.code === "ENOENT" ? notFoundHint(cmd) : e.message, { command: cmd }),
      );
    });
    child.on("close", (code) => {
      if (code === 0) finish(resolve, out);
      else {
        const detail = (err || out).trim() || "sem detalhes";
        finish(reject, new TermuxError(`${cmd} falhou (código ${code}): ${detail}`, { command: cmd }));
      }
    });
    child.stdin.on("error", () => {}); // o comando pode fechar a entrada antes
    child.stdin.end(input ?? "");
  });
}

/** Roda um comando que imprime JSON e devolve o objeto (ou null se vazio). */
export async function runJson(cmd, args = [], opts) {
  const out = (await run(cmd, args, opts)).trim();
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch {
    throw new TermuxError(`Resposta inesperada de ${cmd}: ${out.slice(0, 300)}`, { command: cmd });
  }
}

/** true se o comando existe no PATH (sem executá-lo). */
export async function hasCommand(cmd) {
  try {
    await run("sh", ["-c", `command -v "$1" >/dev/null 2>&1`, "sh", cmd], { timeoutMs: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Pede confirmação ao usuário antes de uma ação sensível.
 * @param {string} message o que o Claude quer fazer
 * @param {"dialogo"|"digital"|"nenhum"} mode
 */
export async function confirmar(message, mode = "dialogo") {
  if (mode === "nenhum") return true;
  if (mode === "digital") {
    const r = await runJson(
      "termux-fingerprint",
      ["-t", "Claude no tablet", "-d", message, "-c", "Cancelar"],
      { timeoutMs: 90_000 },
    );
    return r?.auth_result === "AUTH_RESULT_SUCCESS";
  }
  const r = await runJson("termux-dialog", ["confirm", "-t", "Permitir ação do Claude?", "-i", message], {
    timeoutMs: 120_000,
  });
  return r?.text === "yes";
}
