import type { Pack, PackInfo } from "../types/order"

export const PACKS: Record<Pack, PackInfo> = {
  platino: {
    id: "platino",
    name: "Platino",
    price: 50000,
    tagline: "Optimización Integral de Windows",
    emoji: "⚡",
  },
  diamante: {
    id: "diamante",
    name: "Diamante",
    price: 70000,
    tagline: "Elite Hardware Tuning (BIOS)",
    emoji: "💎",
  },
}

export const PACK_LIST: PackInfo[] = [PACKS.platino, PACKS.diamante]
