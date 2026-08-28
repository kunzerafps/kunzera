// Aviso a Meta de que una venta manual ya cargada se anuló (el cliente se
// arrepintió / no pagó). Meta NO tiene un "deshacer" para una compra ya
// contada, así que se manda un evento PERSONALIZADO "CompraCancelada" con el
// mismo order_id y el valor original.
//
// Qué hace y qué NO hace:
//   - NO resta solo de la cuenta de "Compras" que muestra Meta.
//   - SÍ le deja a quien maneja las campañas la información para armar una
//     métrica de "ingresos netos" (compras menos canceladas) con una
//     Conversión Personalizada sobre este evento.
//
// Comparte solo los helpers puros de hash con el resto del proyecto
// (metaUserData.ts). Store de deduplicación propio.
import { getStore } from "@netlify/blobs"
import { sha256Hex, stripAccents, normalizePhoneForHash } from "./metaUserData"
import { META_PIXEL_ID } from "./metaPixelId"

const ALREADY_SENT_STORE = "capi-cancel-events-sent"

export type MetaCancelEvent = {
  // El mismo event_id de la compra original (huella determinística de la
  // venta). El evento de cancelación usa "cancel-<eventId>" como su propio
  // event_id, para deduplicar reintentos sin chocar con la compra.
  eventId: string
  value: number
  whatsapp?: string
  nombre?: string
  email?: string
  countryCode?: string
  // Unix seconds — por default "ahora".
  eventTime?: number
}

export type MetaCancelResult = { ok: true } | { ok: false; error: string }

export async function sendMetaCancelEvent(p: MetaCancelEvent): Promise<MetaCancelResult> {
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN
  if (!accessToken) return { ok: false, error: "no_access_token" }

  const cancelEventId = `cancel-${p.eventId}`

  try {
    if ((await getStore(ALREADY_SENT_STORE).get(cancelEventId, { consistency: "strong" })) !== null) {
      return { ok: true }
    }
  } catch {
    // Lectura falló: seguimos. Meta deduplica por event_id de todas formas.
  }

  const userData: Record<string, string[]> = {}
  if (p.whatsapp) userData.ph = [await sha256Hex(normalizePhoneForHash(p.whatsapp))]
  if (p.email) userData.em = [await sha256Hex(p.email.trim().toLowerCase())]
  if (p.nombre) {
    const words = p.nombre.trim().toLowerCase().split(/\s+/)
    const last = words.length > 1 ? words.pop() : undefined
    const first = words.join(" ")
    if (first) userData.fn = [await sha256Hex(stripAccents(first))]
    if (last) userData.ln = [await sha256Hex(stripAccents(last))]
  }
  if (p.countryCode) userData.country = [await sha256Hex(p.countryCode.trim().toLowerCase())]

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(process.env.META_CAPI_TEST_EVENT_CODE
            ? { test_event_code: process.env.META_CAPI_TEST_EVENT_CODE }
            : {}),
          data: [
            {
              event_name: "CompraCancelada",
              event_time: p.eventTime ?? Math.floor(Date.now() / 1000),
              action_source: "business_messaging",
              messaging_channel: "whatsapp",
              event_id: cancelEventId,
              user_data: userData,
              custom_data: { currency: "ARS", value: p.value, order_id: p.eventId },
            },
          ],
        }),
        signal: controller.signal,
      },
    )

    if (!res.ok) {
      const errText = await res.text().catch(() => "")
      const error = `http_${res.status}: ${errText}`
      console.error("[metaCapiCancel] Meta rechazó CompraCancelada:", error)
      return { ok: false, error }
    }

    try {
      await getStore(ALREADY_SENT_STORE).set(cancelEventId, "1")
    } catch (err) {
      console.error("[metaCapiCancel] no se pudo marcar el evento como enviado:", err)
    }

    return { ok: true }
  } catch (err) {
    console.error("[metaCapiCancel] error inesperado:", err)
    return { ok: false, error: String(err) }
  } finally {
    clearTimeout(timer)
  }
}
