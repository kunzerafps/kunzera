import type { Pack } from "../types/order"
import { PACKS } from "./packs"

export type PackPrices = { ars: number; usd: number }
export type Prices = Record<Pack, PackPrices>

export const DEFAULT_PRICES: Prices = {
  platino: { ars: PACKS.platino.price, usd: PACKS.platino.usdPrice },
  diamante: { ars: PACKS.diamante.price, usd: PACKS.diamante.usdPrice },
}

let current: Prices = DEFAULT_PRICES

export function setCurrentPrices(p: Prices) {
  current = {
    platino: { ars: p.platino.ars, usd: p.platino.usd },
    diamante: { ars: p.diamante.ars, usd: p.diamante.usd },
  }
}

export function getCurrentPrices(): Prices {
  return current
}

export function getArs(pack: Pack): number {
  return current[pack].ars
}

export function getUsd(pack: Pack): number {
  return current[pack].usd
}

// Parámetros estándar de producto para los eventos de Meta ligados a un pack
// (AddToCart, Lead, InitiateCheckout). Un solo lugar para que el navegador y
// el servidor manden EXACTAMENTE lo mismo: el precio ACTUAL del pack como
// `value` (usa getArs, no el precio hardcodeado, para que coincida con
// InitiateCheckout y Purchase si los precios se cambian desde el panel), el
// slug como `content_ids` (identificador estable para agrupar) y el nombre
// visible como `content_name`.
export function packEventParams(pack: Pack | string | undefined): Record<string, unknown> {
  if (pack !== "platino" && pack !== "diamante") return {}
  return {
    value: getArs(pack),
    currency: "ARS",
    content_name: PACKS[pack].name,
    content_ids: [pack],
    content_type: "product",
  }
}
