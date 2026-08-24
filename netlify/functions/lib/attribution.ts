import { getStore } from "@netlify/blobs"

const STORE_NAME = "attribution-data"

// Datos de contexto del comprador capturados en el momento en que entra a
// pagar (ver capture-attribution.mts / PaymentStep.tsx), NO cuando se
// confirma el pago después — para transferencia/binance eso puede ser horas
// o días más tarde, momento en el que ya no hay forma de leer la IP/cookies
// reales del comprador. `fbp`/`fbc` viajan tal cual las puso el propio píxel
// de Meta en las cookies del navegador (nunca se inventan). Meta no pide
// que estos 4 campos vayan hasheados — a diferencia de teléfono/nombre/email.
export type AttributionData = {
  fbp?: string
  fbc?: string
  ip?: string
  userAgent?: string
  // De qué campaña vino la visita, leído de los parámetros utm_* del link
  // (ver src/lib/utm.ts) — solo se guarda si el link traía utm_source. Se usa
  // para mostrarlo en el panel admin (get-attribution.mts), no se le manda a
  // Meta.
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  capturedAt: number
}

export async function saveAttribution(idempotencyKey: string, data: AttributionData): Promise<void> {
  await getStore(STORE_NAME).setJSON(idempotencyKey, data)
}

// Best-effort: si Blobs falla o no hay nada guardado (reserva vieja, de
// antes de este cambio; o venta manual, que no tiene sesión de navegador),
// el evento de Compra se manda igual, solo que sin estos campos — degrada
// el Event Match Quality, no bloquea el tracking de la venta.
export async function getAttribution(idempotencyKey: string): Promise<AttributionData | null> {
  try {
    return (await getStore(STORE_NAME).get(idempotencyKey, { type: "json" })) as AttributionData | null
  } catch {
    return null
  }
}
