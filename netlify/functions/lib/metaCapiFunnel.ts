// Envío server-side de los eventos de mitad de embudo (Lead cuando el
// cliente deja un WhatsApp válido, InitiateCheckout cuando entra a pagar).
// El navegador YA dispara estos eventos por el píxel, pero sin ningún dato
// que identifique a la persona: para quien tiene bloqueador de anuncios o
// Safari/iOS, Meta los recibe "anónimos" y casi no los puede usar para
// optimizar. Este camino manda una copia desde el servidor CON el teléfono
// y el nombre hasheados (que la web ya tiene en ese punto del flujo), más
// la IP/user-agent reales.
//
// Deduplicación: cada evento del navegador y su copia server-side comparten
// el mismo `event_id` (lo genera el cliente, ver src/lib/pixel.ts). Meta los
// une en uno solo. Acá NO aplica el problema que obligó a sacar el píxel de
// Purchase (ver metaCapi.ts): navegador y servidor disparan con segundos de
// diferencia, muy dentro de la ventana de dedup de 48hs de Meta.
//
// A propósito NO comparte código con metaCapi.ts (Purchase): ese archivo
// tiene idempotencia de venta y event_time histórico afinados a fuerza de
// bugs reales. Acá sólo se comparten los helpers puros de hash
// (metaUserData.ts), no la lógica de negocio. Store de dedup propio,
// separado del de Purchase y del de PageView.
import { getStore } from "@netlify/blobs"
import { sha256Hex, stripAccents, normalizePhoneForHash } from "./metaUserData"
import { META_PIXEL_ID } from "./metaPixelId"
import { PACKS } from "../../../src/lib/packs"
import type { Pack } from "../../../src/types/order"

const ALREADY_SENT_STORE = "capi-funnel-events-sent"
const EVENT_SOURCE_URL = "https://kunzera.com/"

// Sólo estos. Cualquier otro nombre que llegue al endpoint se ignora (no
// queremos que un cliente manipulado mande "Purchase" por acá y ensucie el
// reporting de ventas, que es 100% server-side y auditado). Purchase NUNCA
// va en esta lista.
export const FUNNEL_EVENTS = [
  "Lead",
  "InitiateCheckout",
  "ViewContent",
  "AddToCart",
  "turno_seleccionado",
  "Schedule",
] as const
export type FunnelEventName = (typeof FUNNEL_EVENTS)[number]

export type MetaCapiFunnelEvent = {
  eventId: string
  eventName: FunnelEventName
  // PII — se hashean acá antes de salir a Meta (nunca viajan en texto plano).
  whatsapp?: string
  nombre?: string
  // ID propio y estable del navegador (ver src/lib/visitorId.ts) — Meta lo
  // espera hasheado igual que el teléfono. Deja que Meta reconozca que la
  // visita anónima y una compra posterior son la misma persona.
  externalId?: string
  // Sin hash — Meta los espera en texto plano.
  fbp?: string
  fbc?: string
  clientIpAddress?: string
  clientUserAgent?: string
  // custom_data
  value?: number
  currency?: string
  // Si viene `contentIds`, se usa tal cual junto con `contentName` (texto
  // libre) y `contentType`. Si NO viene, se cae al modo viejo: `contentName`
  // se interpreta como slug de pack y de ahí se arma content_ids + el nombre
  // visible.
  contentName?: string
  contentIds?: string[]
  contentType?: string
}

export type MetaCapiResult = { ok: true } | { ok: false; error: string }

export async function sendMetaFunnelEvent(params: MetaCapiFunnelEvent): Promise<MetaCapiResult> {
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN
  if (!accessToken) return { ok: false, error: "no_access_token" }

  // Idempotencia local, mismo criterio que metaCapiPageView.ts: si el
  // cliente reintenta el POST (fetch colgado + recarga, doble-mount de
  // StrictMode en dev) no gastamos cuota de Meta de nuevo por el mismo id.
  try {
    const already = await getStore(ALREADY_SENT_STORE).get(params.eventId, { consistency: "strong" })
    if (already !== null) return { ok: true }
  } catch {
    // Lectura falló: seguimos. En el peor caso Meta recibe un duplicado y
    // lo deduplica él por event_id.
  }

  const userData: Record<string, string[]> = {}
  if (params.whatsapp) {
    userData.ph = [await sha256Hex(normalizePhoneForHash(params.whatsapp))]
  }
  if (params.nombre) {
    // Misma partición que metaCapi.ts: la última palabra es el apellido,
    // el resto es el nombre (nombres compuestos son el caso común en AR).
    const words = params.nombre.trim().toLowerCase().split(/\s+/)
    const last = words.length > 1 ? words.pop() : undefined
    const first = words.join(" ")
    if (first) userData.fn = [await sha256Hex(stripAccents(first))]
    if (last) userData.ln = [await sha256Hex(stripAccents(last))]
  }
  if (params.externalId) {
    userData.external_id = [await sha256Hex(params.externalId.trim().toLowerCase())]
  }

  const rawUserData: Record<string, string> = {}
  if (params.fbp) rawUserData.fbp = params.fbp
  if (params.fbc) rawUserData.fbc = params.fbc
  if (params.clientIpAddress) rawUserData.client_ip_address = params.clientIpAddress
  if (params.clientUserAgent) rawUserData.client_user_agent = params.clientUserAgent

  const customData: Record<string, unknown> = {}
  if (typeof params.value === "number" && Number.isFinite(params.value)) {
    customData.value = params.value
    customData.currency = params.currency || "ARS"
  }
  if (params.contentIds && params.contentIds.length > 0) {
    // Modo nuevo: el cliente ya mandó todo resuelto (ver src/lib/prices.ts →
    // packEventParams, y el ViewContent de la sección de precios que manda
    // los dos packs). Se usa tal cual.
    customData.content_ids = params.contentIds
    customData.content_type = params.contentType || "product"
    if (params.contentName) customData.content_name = params.contentName
  } else if (params.contentName) {
    // Modo viejo (compat): el cliente manda el slug interno
    // ("platino"/"diamante"); se muestra el nombre visible del pack para que
    // el reporting de Meta sea legible, pero se conserva el slug como
    // content_ids (identificador estable) — igual que hace metaCapi.ts.
    customData.content_name = PACKS[params.contentName as Pack]?.name ?? params.contentName
    customData.content_ids = [params.contentName]
    customData.content_type = params.contentType || "product"
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // En el deploy de prueba (META_CAPI_TEST_EVENT_CODE seteado) estos
          // eventos también van a "Eventos de prueba" de Meta, no a las
          // campañas reales — igual que Purchase (metaCapi.ts).
          ...(process.env.META_CAPI_TEST_EVENT_CODE
            ? { test_event_code: process.env.META_CAPI_TEST_EVENT_CODE }
            : {}),
          data: [
            {
              event_name: params.eventName,
              event_time: Math.floor(Date.now() / 1000),
              action_source: "website",
              event_source_url: EVENT_SOURCE_URL,
              event_id: params.eventId,
              user_data: { ...userData, ...rawUserData },
              ...(Object.keys(customData).length > 0 ? { custom_data: customData } : {}),
            },
          ],
        }),
        signal: controller.signal,
      },
    )

    if (!res.ok) {
      const errText = await res.text().catch(() => "")
      const error = `http_${res.status}: ${errText}`
      console.error(`[metaCapiFunnel] Meta rechazó ${params.eventName}:`, error)
      return { ok: false, error }
    }

    try {
      await getStore(ALREADY_SENT_STORE).set(params.eventId, "1")
    } catch (err) {
      console.error("[metaCapiFunnel] no se pudo marcar el evento como enviado:", err)
    }

    return { ok: true }
  } catch (err) {
    console.error(`[metaCapiFunnel] error inesperado mandando ${params.eventName}:`, err)
    return { ok: false, error: String(err) }
  } finally {
    clearTimeout(timer)
  }
}
