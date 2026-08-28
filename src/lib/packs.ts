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
}

export const PACK_LIST: PackInfo[] = [PACKS.platino, PACKS.diamante]

// Parámetros estándar de producto para los eventos de Meta ligados a un pack
// (AddToCart, Lead, InitiateCheckout). Un solo lugar para que el navegador y
// el servidor manden EXACTAMENTE lo mismo: el precio del pack como `value`
// (deja que Meta optimice por plata, no solo por "hizo algo"), el slug como
// `content_ids` (identificador estable para agrupar conversiones por producto)
// y el nombre visible como `content_name`.
export function packEventParams(pack: Pack | string | undefined): Record<string, unknown> {
  const info = pack ? (PACKS as Record<string, PackInfo>)[pack] : undefined
  if (!info) return {}
  return {
    value: info.price,
    currency: "ARS",
    content_name: info.name,
    content_ids: [info.id],
    content_type: "product",
  }
}
