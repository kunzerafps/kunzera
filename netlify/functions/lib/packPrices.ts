import { getStore } from "@netlify/blobs"
import { PACKS } from "../../../src/lib/packs"

// Precio REAL de cada pack, leído del servidor — nunca de lo que manda el
// navegador.
//
// Por qué existe: `/api/capi-funnel` es un endpoint público y sin
// contraseña (tiene que serlo: lo llama cualquier visitante anónimo para
// mandar la copia server-side de los eventos del embudo, la que los
// bloqueadores de publicidad no pueden tapar). Hasta ahora aceptaba el
// `value` numérico que viniera en el body sin verificarlo contra nada: solo
// se validaba el NOMBRE del evento. Cualquiera podía mandarle a Meta cientos
// de "dejó los datos" por $999.999.999 y ensuciar la optimización por valor.
//
// Ojo con lo que NO se puede falsificar, para dimensionar el riesgo: los
// eventos de Compra y "Reservó" no salen por ese endpoint (ver
// FUNNEL_EVENTS / SERVER_ONLY_FUNNEL_EVENTS en metaCapiFunnel.ts), así que
// desde afuera nunca se pudo inventar una venta — solo ensuciar las señales
// del medio del embudo.
//
// Misma fuente de verdad que usa el sitio: el blob `site-config`, que es
// donde el panel admin guarda los precios cuando Eze los cambia. Si no se
// puede leer, se cae a los precios por defecto de packs.ts en vez de
// confiar en el cliente.
const STORE_NAME = "site-config"
const KEY = "site-config"

export type PackSlug = "platino" | "diamante"

const DEFAULT_ARS: Record<PackSlug, number> = {
  platino: PACKS.platino.price,
  diamante: PACKS.diamante.price,
}

export function isPackSlug(v: unknown): v is PackSlug {
  return v === "platino" || v === "diamante"
}

function readArs(raw: unknown, fallback: number): number {
  const obj = (raw ?? {}) as { ars?: unknown }
  const v = typeof obj.ars === "number" ? obj.ars : Number(obj.ars)
  return Number.isFinite(v) && v > 0 ? v : fallback
}

// Devuelve los precios vigentes en ARS. Best-effort: cualquier problema de
// Blobs cae a los valores por defecto — es preferible un precio de lista
// levemente desactualizado a creerle un monto al navegador.
export async function getServerPackPricesArs(): Promise<Record<PackSlug, number>> {
  try {
    const raw = (await getStore(STORE_NAME).get(KEY, { type: "json" })) as
      | { prices?: { platino?: unknown; diamante?: unknown } }
      | null
    if (!raw?.prices) return DEFAULT_ARS
    return {
      platino: readArs(raw.prices.platino, DEFAULT_ARS.platino),
      diamante: readArs(raw.prices.diamante, DEFAULT_ARS.diamante),
    }
  } catch {
    return DEFAULT_ARS
  }
}
