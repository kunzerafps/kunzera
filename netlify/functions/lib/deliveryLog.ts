import { getStore } from "@netlify/blobs"

const STORE_NAME = "capi-delivery-log"

export type DeliverySource = "mercadopago" | "transferencia_binance" | "venta_manual"

// Sin PII a propósito: ni nombre, ni teléfono, ni monto. Solo lo necesario
// para responder "¿qué se mandó, cuándo, cuántas veces, qué contestó Meta?"
// sin duplicar datos personales que ya viven en el Sheet/Blobs de la orden.
export type DeliveryLogEntry = {
  eventId: string
  source: DeliverySource
  attempts: number
  lastAttemptAt: number
  ok: boolean
  error?: string
  dedupedLocally: boolean
  // Fecha real (YYYY-MM-DD, hora Argentina) de la venta que representa este
  // evento — no siempre coincide con lastAttemptAt (ej. venta manual cargada
  // un día después de cerrada por WhatsApp). Opcional para no romper
  // compatibilidad con entradas viejas que no la tenían; hoy solo la manda
  // capi-venta-manual.mts, que es el único caso donde puede backdatearse.
  saleDate?: string
}

export async function recordDelivery(entry: {
  eventId: string
  source: DeliverySource
  ok: boolean
  error?: string
  dedupedLocally: boolean
  saleDate?: string
}): Promise<void> {
  try {
    const store = getStore(STORE_NAME)
    const existing = (await store.get(entry.eventId, { type: "json" })) as DeliveryLogEntry | null
    const record: DeliveryLogEntry = {
      eventId: entry.eventId,
      source: entry.source,
      attempts: (existing?.attempts || 0) + 1,
      lastAttemptAt: Date.now(),
      ok: entry.ok,
      error: entry.error,
      dedupedLocally: entry.dedupedLocally,
      saleDate: entry.saleDate,
    }
    await store.setJSON(entry.eventId, record)
  } catch (err) {
    // No debe romper el envío en sí — esto es un log, no la ruta crítica.
    console.error("[deliveryLog] no se pudo registrar:", err)
  }
}

// Usa list() de Netlify Blobs en vez de mantener un índice manual aparte.
//
// OJO con el orden: las claves de esta store son event_id (hashes), NO están
// ordenadas por fecha. La versión anterior ordenaba por `key` y recortaba a
// `limit` ANTES de traer los datos, así que una vez que la store pasaba de
// `limit` filas devolvía un subconjunto lexicográfico que podía dejar
// afuera TODAS las entregas recientes — y el chequeo diario
// (daily-gap-report.mts) empezaba a comparar contra datos incompletos, en
// silencio. Ahora se traen todas, se ordena por lastAttemptAt real y recién
// después se recorta.
// (TODO si esto crece a decenas de miles: índice por fecha, o list() con
// prefijo de timestamp en la clave.)
export async function listRecentDeliveries(limit: number): Promise<DeliveryLogEntry[]> {
  const store = getStore(STORE_NAME)
  const { blobs } = await store.list()
  const entries = await Promise.all(
    blobs.map((b) => store.get(b.key, { type: "json" }) as Promise<DeliveryLogEntry | null>),
  )
  return entries
    .filter((e): e is DeliveryLogEntry => e !== null)
    .sort((a, b) => b.lastAttemptAt - a.lastAttemptAt)
    .slice(0, limit)
}
