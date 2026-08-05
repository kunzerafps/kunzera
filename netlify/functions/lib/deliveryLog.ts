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
}

export async function recordDelivery(entry: {
  eventId: string
  source: DeliverySource
  ok: boolean
  error?: string
  dedupedLocally: boolean
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
    }
    await store.setJSON(entry.eventId, record)
  } catch (err) {
    // No debe romper el envío en sí — esto es un log, no la ruta crítica.
    console.error("[deliveryLog] no se pudo registrar:", err)
  }
}

// Usa list() de Netlify Blobs en vez de mantener un índice manual aparte —
// menos superficie de bugs, y esta store no va a crecer a un tamaño donde
// listar todo sea un problema real para "primera versión".
export async function listRecentDeliveries(limit: number): Promise<DeliveryLogEntry[]> {
  const store = getStore(STORE_NAME)
  const { blobs } = await store.list()
  const sorted = [...blobs].sort((a, b) => (a.key < b.key ? 1 : -1)).slice(0, limit)
  const entries = await Promise.all(
    sorted.map((b) => store.get(b.key, { type: "json" }) as Promise<DeliveryLogEntry | null>),
  )
  return entries
    .filter((e): e is DeliveryLogEntry => e !== null)
    .sort((a, b) => b.lastAttemptAt - a.lastAttemptAt)
}
