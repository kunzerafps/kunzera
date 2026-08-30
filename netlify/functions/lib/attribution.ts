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
  // Geolocalización aproximada que Netlify ya resuelve gratis a partir de la
  // IP del request (ctx.geo) — no se le pregunta nada nuevo al cliente. Sin
  // hashear acá (igual que fbp/fbc/ip/userAgent); metaCapi.ts es quien hashea
  // antes de mandarlo a Meta como ct/st/zp/country.
  city?: string
  region?: string
  postalCode?: string
  countryCode?: string
  // ID propio y estable del navegador (ver src/lib/visitorId.ts) — se guarda
  // acá sin hashear; metaCapi.ts lo hashea antes de mandarlo como external_id
  // en el evento de Compra. Deja que Meta una esa compra con la visita
  // anónima previa (el PageView server-side manda el mismo id).
  visitorId?: string
  // Mail que la persona dejó en el chat (paso opcional askEmail). Se guarda
  // acá, y NO en el Sheet, porque el campo `email` del payload del Apps
  // Script es un honeypot anti-spam: Code.gs:108 rechaza la reserva entera
  // con "spam_detected" si llega con algo. Sin hashear — metaCapi.ts lo
  // normaliza y hashea antes de mandarlo como `em`.
  //
  // Es la señal que más sube la calidad de coincidencia de Meta y la que más
  // faltaba: llegaba solo en el 40% de las compras (Mercado Pago lo trae
  // solo, las ventas manuales lo piden, pero transferencia y Binance —la
  // mayoría— no lo pedían en ningún paso).
  email?: string
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
