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
