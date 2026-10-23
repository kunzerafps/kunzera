import type { Pack, PackInfo } from "../types/order"

export const PACKS: Record<Pack, PackInfo> = {
  platino: {
    id: "platino",
    name: "Platino",
    price: 50000,
    usdPrice: 45,
    tagline: "Ajuste completo de tu Windows, por software",
    emoji: "⚡",
  },
  diamante: {
    id: "diamante",
    name: "Diamante",
    price: 70000,
    usdPrice: 65,
    tagline: "Todo Platino + entro directo al hardware (BIOS)",
    emoji: "💎",
  },
  formateo: {
    id: "formateo",
    name: "Diamante + Formateo",
    price: 100000,
    usdPrice: 90,
    tagline: "Windows instalado desde cero + todo Diamante",
    emoji: "🔄",
  },
}

export const PACK_LIST: PackInfo[] = [PACKS.platino, PACKS.diamante, PACKS.formateo]
