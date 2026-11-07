// Converte arquivos do tablet (imagens, PDFs, textos) em blocos de conteúdo
// para a API do Claude.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { run, hasCommand, TermuxError } from "./termux.mjs";

export const IMAGE_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const TEXT_EXT = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".xml", ".html", ".htm", ".yaml", ".yml",
  ".log", ".ini", ".conf", ".js", ".mjs", ".ts", ".py", ".java", ".kt", ".c", ".cpp", ".h", ".sh",
  ".sql", ".srt", ".vtt",
]);

// A API aceita imagens de até 5 MB; em base64 o tamanho cresce 4/3.
// Acima deste limite reduzimos a imagem com o ImageMagick.
export const MAX_IMAGE_BYTES = 3_700_000;
const MAX_PDF_BYTES = 30_000_000;
const MAX_TEXT_BYTES = 2_000_000;

export function isImage(file) {
  return Boolean(IMAGE_TYPES[path.extname(file).toLowerCase()]);
}

async function shrinkImage(file) {
  const tool = (await hasCommand("magick")) ? "magick" : (await hasCommand("convert")) ? "convert" : null;
  if (!tool) {
    throw new TermuxError(
      `A imagem ${path.basename(file)} passa de 5 MB. Instale o ImageMagick ("pkg install imagemagick") ` +
        `para o claude-tab reduzi-la automaticamente.`,
    );
  }
  const out = path.join(os.tmpdir(), `claude-tab-${process.pid}-${Date.now()}.jpg`);
  // "2560x2560>" só reduz quando a imagem é maior que isso, mantendo a proporção.
  await run(tool, [file, "-auto-orient", "-resize", "2560x2560>", "-quality", "85", out], {
    timeoutMs: 60_000,
  });
  try {
    return await fs.readFile(out);
  } finally {
    await fs.rm(out, { force: true });
  }
}

/** Lê uma imagem e devolve {media_type, data(base64)}, reduzindo se necessário. */
export async function readImage(file) {
  const ext = path.extname(file).toLowerCase();
  let mediaType = IMAGE_TYPES[ext];
  if (!mediaType) throw new TermuxError(`Formato de imagem não suportado: ${ext || "(sem extensão)"}`);
  let buf = await fs.readFile(file);
  if (buf.length > MAX_IMAGE_BYTES) {
    buf = await shrinkImage(file);
    mediaType = "image/jpeg";
  }
  return { media_type: mediaType, data: buf.toString("base64") };
}

/** Bloco de imagem no formato da API. */
export async function imageBlock(file) {
  const { media_type, data } = await readImage(file);
  return { type: "image", source: { type: "base64", media_type, data } };
}

/** Converte um arquivo em blocos de conteúdo (imagem, PDF ou texto). */
export async function fileToBlocks(file) {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) throw new TermuxError(`Arquivo não encontrado: ${file}`);
  const ext = path.extname(file).toLowerCase();
  const name = path.basename(file);

  if (isImage(file)) return [await imageBlock(file)];

  if (ext === ".pdf") {
    if (stat.size > MAX_PDF_BYTES) throw new TermuxError(`O PDF ${name} passa de 30 MB.`);
    const data = (await fs.readFile(file)).toString("base64");
    return [
      { type: "document", title: name, source: { type: "base64", media_type: "application/pdf", data } },
    ];
  }

  if (TEXT_EXT.has(ext) || ext === "") {
    if (stat.size > MAX_TEXT_BYTES) throw new TermuxError(`O arquivo ${name} é grande demais (> 2 MB).`);
    const text = await fs.readFile(file, "utf8");
    return [{ type: "text", text: `Conteúdo do arquivo "${name}":\n\n${text}` }];
  }

  throw new TermuxError(
    `Tipo de arquivo não suportado (${ext}). Use imagem (jpg, png, webp, gif), PDF ou texto.`,
  );
}

/** Arquivo de imagem mais recente entre as pastas dadas (ou null). */
export async function newestImage(dirs) {
  let best = null;
  for (const dir of dirs) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !isImage(e.name)) continue;
      const full = path.join(dir, e.name);
      const { mtimeMs } = await fs.stat(full);
      if (!best || mtimeMs > best.mtimeMs) best = { file: full, mtimeMs };
    }
  }
  return best;
}
