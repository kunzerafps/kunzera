// Registro de las ventas cerradas 100% por WhatsApp (las que carga el admin
// desde "Venta manual" en el panel). Hasta ahora esas ventas solo se
// avisaban a Meta y no quedaban en ningún lado: sin lista, sin número de
// orden que el admin pudiera anotar. Este store lo arregla.
//
// A propósito NO vive en el Sheet de reservas ni pasa por Apps Script —
// misma decisión que ya toma capi-venta-manual.mts: esto es un libro de
// ventas propio del sitio, separado del flujo de turnos.
//
// La clave de cada entrada es el `metaEventId` (la huella determinística
// teléfono+monto+fecha que también se manda a Meta como event_id): si el
// admin carga la MISMA venta dos veces sin querer, la segunda escritura cae
// sobre la misma clave en vez de crear una fila duplicada, igual que Meta la
// deduplica sola del otro lado. El `id` legible (KZM-...) es un campo, no la
// clave, y es lo único que ve/copia el admin.
import { getStore } from "@netlify/blobs"

const STORE_NAME = "ventas-manuales"

export type ManualSaleMetaStatus = "ok" | "error"

export type ManualSale = {
  // KZM-AAMMDD-XXXX — legible, dictable, ordenable por fecha. Lo que el
  // admin copia y anota. NO es la clave del blob (esa es metaEventId).
  id: string
  // Unix ms de cuándo se cargó en el panel (no cuándo pasó la venta).
  createdAt: number
  // YYYY-MM-DD, fecha real de la venta en hora Argentina.
  saleDate: string
  nombre: string
  // Tal cual lo tipeó el admin — sin normalizar (la normalización para el
  // hash de Meta la hace metaCapi.ts).
  whatsapp: string
  email: string
  monto: number
  // Slug del pack ("platino"/"diamante") o texto libre si eligió "otro".
  pack?: string
  // De qué campaña/anuncio vino, según lo que el admin vio en WhatsApp
  // Business. Texto libre por ahora.
  campania?: string
  // El event_id que se mandó a Meta (huella determinística). Es la clave
  // del blob.
  metaEventId: string
  metaStatus: ManualSaleMetaStatus
  // Texto del error de Meta si metaStatus === "error" — para poder
  // reintentar y para diagnosticar.
  metaError?: string
  // La venta se cayó después de cargada (el cliente se arrepintió, no
  // pagó). Se deja el registro y se marca; a Meta ya se le avisó y no hay
  // un "deshacer" simple, es ruido mínimo.
  canceled?: boolean
  nota?: string
}

// Alfabeto sin caracteres que se confunden al dictar o copiar a mano:
// sin 0/O, sin 1/I/L.
const ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

// `rand` inyectable solo para que los tests puedan fijar el sufijo.
export function generateManualSaleId(saleDate: string, rand: () => number = Math.random): string {
  const compact = saleDate.replace(/-/g, "").slice(2) // "2026-08-27" -> "260827"
  let suffix = ""
  for (let i = 0; i < 4; i++) {
    suffix += ID_ALPHABET[Math.floor(rand() * ID_ALPHABET.length)]
  }
  return `KZM-${compact}-${suffix}`
}

export async function saveManualSale(sale: ManualSale): Promise<void> {
  const store = getStore(STORE_NAME)
  await store.setJSON(sale.metaEventId, sale)
}

export async function getManualSaleByEvent(eventId: string): Promise<ManualSale | null> {
  const store = getStore(STORE_NAME)
  return (await store.get(eventId, { type: "json" })) as ManualSale | null
}

export async function updateManualSaleByEvent(
  eventId: string,
  patch: Partial<ManualSale>,
): Promise<ManualSale | null> {
  const store = getStore(STORE_NAME)
  const existing = (await store.get(eventId, { type: "json" })) as ManualSale | null
  if (!existing) return null
  // `id` y `metaEventId` no se pisan nunca desde un patch.
  const updated: ManualSale = { ...existing, ...patch, id: existing.id, metaEventId: existing.metaEventId }
  await store.setJSON(eventId, updated)
  return updated
}

// Mismo criterio que deliveryLog.listRecentDeliveries: usa list() de Blobs
// en vez de mantener un índice manual aparte. Esta store crece 1 entrada por
// venta cerrada por WhatsApp — a "primera versión" no llega a un tamaño
// donde traer todo sea un problema real.
export async function listManualSales(limit = 500): Promise<ManualSale[]> {
  const store = getStore(STORE_NAME)
  const { blobs } = await store.list()
  const entries = await Promise.all(
    blobs.map((b) => store.get(b.key, { type: "json" }) as Promise<ManualSale | null>),
  )
  return entries
    .filter((s): s is ManualSale => s !== null)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
}
