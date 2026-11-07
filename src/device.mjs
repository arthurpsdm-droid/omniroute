// Identificação do modelo da linha Galaxy Tab S10 a partir do "model number"
// (Configurações > Sobre o tablet > Número do modelo, ou `getprop ro.product.model`).

import { run } from "./termux.mjs";

export const MODELOS = [
  {
    prefixo: "SM-X92",
    nome: "Galaxy Tab S10 Ultra",
    tela: '14,6" Dynamic AMOLED 2X, 2960×1848, 120 Hz',
    chip: "MediaTek Dimensity 9300+",
    bateria: "11.200 mAh, 45 W",
    resistencia: "IP68",
  },
  {
    prefixo: "SM-X82",
    nome: "Galaxy Tab S10+",
    tela: '12,4" Dynamic AMOLED 2X, 2800×1752, 120 Hz',
    chip: "MediaTek Dimensity 9300+",
    bateria: "10.090 mAh, 45 W",
    resistencia: "IP68",
  },
  {
    prefixo: "SM-X62",
    nome: "Galaxy Tab S10 FE+",
    tela: '13,1" LCD, 2880×1800, 90 Hz',
    chip: "Samsung Exynos 1580",
    bateria: "10.090 mAh, 45 W",
    resistencia: "IP68",
  },
  {
    prefixo: "SM-X52",
    nome: "Galaxy Tab S10 FE",
    tela: '10,9" LCD, 2304×1440, 90 Hz',
    chip: "Samsung Exynos 1580",
    bateria: "8.000 mAh, 45 W",
    resistencia: "IP68",
  },
  {
    prefixo: "SM-X40",
    nome: "Galaxy Tab S10 Lite",
    tela: '10,9" LCD, 2112×1320, 90 Hz',
    chip: "Samsung Exynos 1380",
    bateria: "8.000 mAh",
    resistencia: "IP42",
  },
];

/** Devolve a ficha do modelo ou null se não for da linha Tab S10. */
export function identificarModelo(numeroModelo = "") {
  const n = numeroModelo.trim().toUpperCase();
  return MODELOS.find((m) => n.startsWith(m.prefixo)) ?? null;
}

/** "80500" -> "8.5"; "60100" -> "6.1". A Samsung grava a versão do One UI assim. */
export function versaoOneUI(raw = "") {
  const v = Number.parseInt(raw, 10);
  if (!Number.isFinite(v) || v <= 0) return null;
  const major = Math.floor(v / 10000);
  const minor = Math.floor((v % 10000) / 100);
  return `${major}.${minor}`;
}

async function getprop(name) {
  try {
    return (await run("getprop", [name], { timeoutMs: 5_000 })).trim();
  } catch {
    return "";
  }
}

export async function infoDispositivo() {
  const [modelo, fabricante, android, sdk, oneui] = await Promise.all([
    getprop("ro.product.model"),
    getprop("ro.product.manufacturer"),
    getprop("ro.build.version.release"),
    getprop("ro.build.version.sdk"),
    getprop("ro.build.version.oneui"),
  ]);
  const ficha = identificarModelo(modelo);
  return {
    numero_modelo: modelo || "desconhecido",
    fabricante: fabricante || "desconhecido",
    nome: ficha?.nome ?? "modelo fora da linha Tab S10 (ou não identificado)",
    android: android || "desconhecido",
    api_level: sdk || "desconhecido",
    one_ui: versaoOneUI(oneui) ?? "desconhecido",
    ficha: ficha ?? undefined,
  };
}
