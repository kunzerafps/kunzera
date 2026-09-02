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
import { sha256Hex, stripAccents, normalizePhoneForMeta } from "./metaUserData"
import { metaEventsUrl } from "./metaPixelId"
import { logMetaResponse } from "./metaResponseLog"
import { PACKS } from "../../../src/lib/packs"
import type { Pack } from "../../../src/types/order"

const ALREADY_SENT_STORE = "capi-funnel-events-sent"
const EVENT_SOURCE_URL = "https://kunzera.com/"
// Identifica la integración ante Meta (recomendado por su spec de CAPI).
const PARTNER_AGENT = "kunzera-web"

// Sólo estos. Cualquier otro nombre que llegue al endpoint se ignora (no
// queremos que un cliente manipulado mande "Purchase" por acá y ensucie el
// reporting de ventas, que es 100% server-side y auditado). Purchase NUNCA
// va en esta lista.
// Los que ACEPTA el endpoint público /api/capi-funnel (el navegador puede
// pedir que se manden). "Schedule" salió de acá a propósito: es objetivo de
// campaña y ahora es 100% server-side (igual que Purchase) — se dispara solo
// desde mp-webhook.mts / capi-confirmar-pago.mts cuando la reserva queda
// confirmada de verdad, no desde el navegador. Purchase nunca estuvo acá.
export const FUNNEL_EVENTS = [
  "Lead",
  "InitiateCheckout",
  "ViewContent",
  "AddToCart",
  "turno_seleccionado",
  // Tocó el botón de WhatsApp. Sólo señal / atribución — nunca objetivo de
  // campaña (ver src/lib/pixel.ts).
  "Contact",
] as const
export type FunnelEventName = (typeof FUNNEL_EVENTS)[number]

// Eventos que se mandan por esta misma vía técnica pero SOLO desde el
// servidor, nunca desde el endpoint público — el caller ya verificó que la
// reserva/pago es real.
const SERVER_ONLY_FUNNEL_EVENTS = ["Schedule"] as const
type ServerOnlyFunnelEventName = (typeof SERVER_ONLY_FUNNEL_EVENTS)[number]

export type MetaCapiFunnelEvent = {
  eventId: string
  eventName: FunnelEventName | ServerOnlyFunnelEventName
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
  // Geolocalización aproximada que Netlify ya resuelve gratis desde la IP
  // del request (ver capi-funnel.mts → ctx.geo). Meta SÍ los espera
  // hasheados como ct/st/zp/country, igual que teléfono/nombre — mismo
  // criterio y misma normalización que el evento de Compra (metaCapi.ts).
  city?: string
  region?: string
  postalCode?: string
  countryCode?: string
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
  // Timeout del fetch a Meta. Default 8s. Los callers que corren dentro de
  // otra función con presupuesto ajustado (mp-webhook.mts, después del
  // Purchase) pasan un valor más chico para no arriesgar el wall-clock.
  timeoutMs?: number
  // Unix seconds. Por default "ahora". Los eventos server-only (Schedule)
  // pasan la fecha real de la reserva para que caigan en la misma ventana de
  // atribución que el Purchase de esa misma venta.
  eventTime?: number
  // Store de idempotencia local. Por default el compartido de funnel. Los
  // eventos server-only (Schedule) usan uno propio para que un cliente no
  // pueda pre-sembrar la clave por el endpoint público y saltear el envío
  // real.
  dedupStore?: string
}

export type MetaCapiResult = { ok: true } | { ok: false; error: string }

export async function sendMetaFunnelEvent(params: MetaCapiFunnelEvent): Promise<MetaCapiResult> {
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN
  if (!accessToken) return { ok: false, error: "no_access_token" }

  const dedupStoreName = params.dedupStore ?? ALREADY_SENT_STORE

  // Idempotencia local, mismo criterio que metaCapiPageView.ts: si el
  // cliente reintenta el POST (fetch colgado + recarga, doble-mount de
  // StrictMode en dev) no gastamos cuota de Meta de nuevo por el mismo id.
  try {
    const already = await getStore(dedupStoreName).get(params.eventId, { consistency: "strong" })
    if (already !== null) return { ok: true }
  } catch {
    // Lectura falló: seguimos. En el peor caso Meta recibe un duplicado y
    // lo deduplica él por event_id.
  }

  // Todo el armado del payload (incluido el hash de PII) va DENTRO del try:
  // así esta función nunca rechaza, sólo devuelve { ok: false } — mismo
  // contrato que sendMetaPurchaseEvent. Los callers la usan sin try/catch.
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const userData: Record<string, string[]> = {}
    if (params.whatsapp) {
      // Mismo criterio que metaCapi.ts: si el número no se puede leer como
      // un teléfono real, no se manda `ph`. Este endpoint es público, así
      // que acá llega lo que sea que haya en el body (ver metaUserData.ts).
      const ph = normalizePhoneForMeta(params.whatsapp)
      if (ph) userData.ph = [await sha256Hex(ph)]
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
    // Geo hasheada — misma normalización exacta que metaCapi.ts (sin acentos,
    // minúsculas, sin espacios). zp/country no llevan stripAccents (son ASCII).
    if (params.city) {
      userData.ct = [await sha256Hex(stripAccents(params.city.trim().toLowerCase().replace(/\s+/g, "")))]
    }
    if (params.region) {
      userData.st = [await sha256Hex(stripAccents(params.region.trim().toLowerCase().replace(/\s+/g, "")))]
    }
    if (params.postalCode) {
      userData.zp = [await sha256Hex(params.postalCode.trim().toLowerCase().replace(/\s+/g, ""))]
    }
    if (params.countryCode) {
      userData.country = [await sha256Hex(params.countryCode.trim().toLowerCase())]
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
    } else if (params.eventName === "Contact" && params.contentName) {
      // Contact: contentName es DE DÓNDE tocó WhatsApp ("whatsapp_float",
      // "footer_whatsapp", "chat_bot", …), no un pack. Se manda como texto
      // libre, sin inventarle content_ids/content_type de producto.
      customData.content_name = params.contentName
    } else if (params.contentName) {
      // Modo viejo (compat): el cliente manda el slug interno
      // ("platino"/"diamante"); se muestra el nombre visible del pack para que
      // el reporting de Meta sea legible, pero se conserva el slug como
      // content_ids (identificador estable) — igual que hace metaCapi.ts.
      customData.content_name = PACKS[params.contentName as Pack]?.name ?? params.contentName
      customData.content_ids = [params.contentName]
      customData.content_type = params.contentType || "product"
    }

    timer = setTimeout(() => controller.abort(), params.timeoutMs ?? 8000)
    const res = await fetch(
      metaEventsUrl(accessToken),
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
              event_time: params.eventTime ?? Math.floor(Date.now() / 1000),
              action_source: "website",
              event_source_url: EVENT_SOURCE_URL,
              event_id: params.eventId,
              partner_agent: PARTNER_AGENT,
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

    // Respuesta 2xx: Meta igual puede devolver advertencias (parámetros
    // ignorados, PII mal formada) en el cuerpo. Se loguean — antes se tiraban.
    await logMetaResponse(res, `metaCapiFunnel:${params.eventName}`)

    try {
      await getStore(dedupStoreName).set(params.eventId, "1")
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

// "Schedule" (reserva confirmada) para una reserva del SITIO, disparado
// server-side en el momento en que el pago queda acreditado — desde
// mp-webhook.mts (Mercado Pago) y capi-confirmar-pago.mts (transferencia/
// binance). Antes se disparaba desde el navegador al volver de Mercado Pago
// con "?mp=success", ANTES de que el webhook confirmara el pago: eso contaba
// como conversión reservas que después fallaban (webhook caído, pago
// revertido) e inflaba la campaña optimizada a Schedule. Ahora sale junto con
// el Purchase, sólo cuando la reserva es real.
//
// event_id propio ("<idempotencyKey>-schedule") para no chocar con el del
// Purchase y para que reintentos (webhook + "Marcar como atendido" sobre la
// misma reserva) dedupliquen contra el store local. Store de dedup propio
// (SCHEDULE_DEDUP_STORE) para que un cliente no pueda pre-sembrar la clave
// por /api/capi-funnel y saltear el envío real. timeoutMs corto: corre en
// paralelo al Purchase, no debe arriesgar el wall-clock de la función.
// `eventTime` opcional: transferencia/binance lo pasan (fecha real de la
// reserva) para que Schedule y Purchase de esa venta caigan en la misma
// ventana de atribución; Mercado Pago no lo pasa (el webhook corre en el
// momento real del pago).
const SCHEDULE_DEDUP_STORE = "capi-schedule-events-sent"

export async function sendConfirmedBookingScheduleEvent(p: {
  idempotencyKey: string
  value: number
  contentName?: string
  whatsapp?: string
  nombre?: string
  fbp?: string
  fbc?: string
  clientIpAddress?: string
  clientUserAgent?: string
  city?: string
  region?: string
  postalCode?: string
  countryCode?: string
  externalId?: string
  eventTime?: number
}): Promise<MetaCapiResult> {
  return sendMetaFunnelEvent({
    eventId: `${p.idempotencyKey}-schedule`,
    eventName: "Schedule",
    whatsapp: p.whatsapp,
    nombre: p.nombre,
    externalId: p.externalId,
    fbp: p.fbp,
    fbc: p.fbc,
    clientIpAddress: p.clientIpAddress,
    clientUserAgent: p.clientUserAgent,
    city: p.city,
    region: p.region,
    postalCode: p.postalCode,
    countryCode: p.countryCode,
    value: Number.isFinite(p.value) && p.value > 0 ? p.value : undefined,
    currency: "ARS",
    contentName: p.contentName,
    eventTime: p.eventTime,
    timeoutMs: 3500,
    dedupStore: SCHEDULE_DEDUP_STORE,
  })
}
