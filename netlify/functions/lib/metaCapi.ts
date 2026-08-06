// Cliente para la API de Conversiones de Meta (server-side), compartido por
// todos los caminos que le mandan un evento de Compra a Meta desde el
// servidor: mp-webhook.mts (Mercado Pago), capi-confirmar-pago.mts
// (transferencia/binance, al momento en que el admin confirma el
// comprobante) y capi-venta-manual.mts (ventas cerradas 100% por WhatsApp,
// sin reserva en el sitio).
import { getStore } from "@netlify/blobs"
import { recordDelivery, type DeliverySource } from "./deliveryLog"

// Configurable por variable de entorno para no depender de un valor
// hardcodeado — el fallback es el ID que ya está público en index.html
// (fbq('init', ...)), así que si no se configura META_PIXEL_ID en Netlify
// el comportamiento no cambia. OJO: index.html NO lee esta misma variable
// (es HTML estático, sin templating de build acá) — si alguna vez se migra
// el Pixel a otro dataset, hay que actualizar los dos lugares a mano y
// mantenerlos iguales.
const META_PIXEL_ID = process.env.META_PIXEL_ID || "761377043609509"

const ALREADY_SENT_STORE = "capi-events-sent"

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

// Normaliza a como Meta espera el teléfono para el hash: sólo dígitos, con
// código de país, sin el "0" de larga distancia local (ej. "011 2345-6789"
// → "1123456789" antes de anteponer "549"). Mismo criterio de "549" que ya
// usa el panel admin para armar links de WhatsApp (OrderDetailModal.tsx).
export function normalizePhoneForHash(whatsapp: string): string {
  let digits = whatsapp.replace(/\D/g, "")
  if (digits.startsWith("549")) digits = digits.slice(3)
  else if (digits.startsWith("54") && digits.length > 10) digits = digits.slice(2)
  if (digits.startsWith("0")) digits = digits.slice(1)
  // "15" pre-unificación: mucha gente todavía dicta el número como
  // "<código de área> 15 <número local>" (ej. "3382 15 677871") — ese "15"
  // no es parte del número real, Meta nunca lo va a tener así en el
  // perfil del usuario, y dejarlo adentro del hash rompe el matching. Se
  // busca justo después de un código de área de 2 a 4 dígitos y se saca,
  // solo cuando eso deja exactamente los 10 dígitos esperados (código de
  // área + número local) — evita tocar un "15" que sea parte legítima de
  // otro número por casualidad.
  for (const areaLen of [2, 3, 4]) {
    if (digits.length === 12 && digits.slice(areaLen, areaLen + 2) === "15") {
      digits = digits.slice(0, areaLen) + digits.slice(areaLen + 2)
      break
    }
  }
  return "549" + digits
}

// Meta espera fn/ln sin acentos ni diacríticos (documentado en su spec de
// Advanced Matching/CAPI) — Unicode NFD separa cada letra acentuada en
// base + marca combinante, y se descarta la marca. "ñ" también cae acá
// (se descompone en "n" + tilde combinante).
function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

// Meta rechaza el evento entero si event_time queda fuera de esta ventana
// hacia el pasado (documentado: 7 días). No hay margen "por las dudas": si
// se manda más viejo, Meta lo tira directamente.
export const MAX_EVENT_AGE_DAYS = 7

export type MetaCapiPurchase = {
  eventId: string
  // De dónde viene la venta — solo para el log de observabilidad
  // (deliveryLog.ts), no viaja a Meta.
  source: DeliverySource
  // "website": la compra pasó por el flujo del sitio (aunque el evento se
  // mande después, ej. al confirmar el comprobante) — requiere
  // event_source_url según la spec de Meta, por eso se agrega fijo acá
  // abajo. "business_messaging": venta cerrada por WhatsApp sin pasar por
  // el sitio — categoría específica de Meta para esto, mejor matcheada que
  // "website" para atribuir campañas de click-to-WhatsApp.
  actionSource: "website" | "business_messaging"
  value: number
  contentName?: string
  whatsapp?: string
  nombre?: string
  // Contexto del comprador capturado en el momento de la reserva (ver
  // lib/attribution.ts) — NUNCA se hashean (a diferencia de teléfono/
  // nombre/email). fbc solo debe venir seteado si existía un fbclid/cookie
  // _fbc real; nunca se inventa acá ni en el caller.
  fbp?: string
  fbc?: string
  clientIpAddress?: string
  clientUserAgent?: string
  // Unix seconds de cuándo pasó la venta de verdad — por default "ahora".
  // Para ventas offline cargadas un día después (capi-venta-manual.mts),
  // pasar la fecha real evita que Meta reciba un timestamp de compra que no
  // coincide con cuándo el cliente realmente compró. Los callers deben
  // validar MAX_EVENT_AGE_DAYS ANTES de llamar — acá no se valida para no
  // rechazar en silencio un evento que el caller ya le mostró al usuario
  // como "cargado".
  eventTime?: number
  // Fecha real (YYYY-MM-DD, hora Argentina) de la venta — solo la manda
  // capi-venta-manual.mts hoy, para que daily-gap-report.mts pueda bucketear
  // por el día real de la venta en vez de por cuándo se cargó en el panel.
  saleDate?: string
}

export type MetaCapiResult = { ok: true } | { ok: false; error: string }

// No es dato sensible ni de un cliente — es la URL del sitio, requerida por
// Meta para eventos con action_source "website".
const EVENT_SOURCE_URL = "https://kunzera.com/"

// Manda un evento de Compra a Meta desde el servidor. `eventId` es la clave
// de deduplicación entre distintos intentos/reintentos del mismo evento
// (ver mp-webhook.mts: Mercado Pago puede reenviar la misma notificación).
// Ya NO se comparte con ningún píxel del navegador — todo el tracking de
// Compra se manda 100% server-side (ver useChatFlow.ts para el porqué: la
// ventana de deduplicación de Meta es de 48hs, insuficiente si el evento
// del navegador y el del servidor pueden llegar separados por más tiempo
// que eso, como pasaba con la confirmación manual de transferencia/binance).
export async function sendMetaPurchaseEvent(params: MetaCapiPurchase): Promise<MetaCapiResult> {
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN
  if (!accessToken) {
    await recordDelivery({
      eventId: params.eventId,
      source: params.source,
      ok: false,
      error: "no_access_token",
      dedupedLocally: false,
      saleDate: params.saleDate,
    })
    return { ok: false, error: "no_access_token" }
  }

  // Capa local de idempotencia, además de la deduplicación que hace Meta
  // del otro lado: si dos requests concurrentes (doble-click en "Confirmar
  // pago", reintento de webhook que ya pasó por acá antes) llegan con el
  // mismo eventId, la segunda ni siquiera vuelve a llamar a la API de Meta
  // — se trata como éxito sin gastar cuota ni arriesgar una carrera con la
  // ventana de dedup de Meta. Mismo patrón get-then-set (no atómico, ventana
  // de carrera angosta y aceptada) que ya usa el resto del proyecto con
  // Netlify Blobs — ver alreadyProcessed en mp-webhook.mts.
  try {
    const already = await getStore(ALREADY_SENT_STORE).get(params.eventId, { consistency: "strong" })
    if (already !== null) {
      await recordDelivery({
        eventId: params.eventId,
        source: params.source,
        ok: true,
        dedupedLocally: true,
        saleDate: params.saleDate,
      })
      return { ok: true }
    }
  } catch {
    // Si falla la lectura, seguimos: preferimos correr el riesgo (bajo) de
    // un duplicado que Meta igual va a deduplicar, antes que bloquear el
    // envío por un problema de Blobs.
  }

  try {
    const userData: Record<string, string[]> = {}
    if (params.whatsapp) {
      userData.ph = [await sha256Hex(normalizePhoneForHash(params.whatsapp))]
    }
    if (params.nombre) {
      // La última palabra es el apellido, todo lo anterior es el nombre —
      // no al revés (como estaba antes). Nombres compuestos ("Juan Carlos",
      // "María José") son muy comunes en Argentina y son de LEJOS el caso
      // más frecuente en 3+ palabras; "María José Pérez" con la lógica
      // vieja mandaba fn="maría" / ln="josé pérez" (mal), con esta manda
      // fn="maria jose" / ln="perez" (coincide con cómo Facebook separa
      // nombre/apellido en el perfil real del usuario). Con 2 palabras el
      // resultado es idéntico al de antes.
      const words = params.nombre.trim().toLowerCase().split(/\s+/)
      const last = words.length > 1 ? words.pop() : undefined
      const first = words.join(" ")
      if (first) userData.fn = [await sha256Hex(stripAccents(first))]
      if (last) userData.ln = [await sha256Hex(stripAccents(last))]
    }
    // Campos sin hash — Meta los espera en texto plano, no como PII hasheada.
    const rawUserData: Record<string, string> = {}
    if (params.fbp) rawUserData.fbp = params.fbp
    if (params.fbc) rawUserData.fbc = params.fbc
    if (params.clientIpAddress) rawUserData.client_ip_address = params.clientIpAddress
    if (params.clientUserAgent) rawUserData.client_user_agent = params.clientUserAgent

    // Timeout explícito para no quedar colgados de una API externa (mismo
    // criterio que postJson/getJson en appsScript.ts).
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    let res: Response
    try {
      res = await fetch(
        `https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(accessToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data: [
              {
                event_name: "Purchase",
                event_time: params.eventTime ?? Math.floor(Date.now() / 1000),
                action_source: params.actionSource,
                ...(params.actionSource === "website" ? { event_source_url: EVENT_SOURCE_URL } : {}),
                // Obligatorio para Meta cuando action_source es
                // "business_messaging" (error real encontrado probando en
                // vivo: "Falta el parámetro de canal de mensajes"; probado
                // primero adentro de custom_data — Meta lo siguió pidiendo
                // igual, va a nivel del evento). Todas las ventas manuales
                // de este sitio se cierran por WhatsApp, nunca por
                // Messenger/Instagram.
                ...(params.actionSource === "business_messaging" ? { messaging_channel: "whatsapp" } : {}),
                event_id: params.eventId,
                user_data: { ...userData, ...rawUserData },
                custom_data: {
                  currency: "ARS",
                  value: params.value,
                  content_name: params.contentName,
                  content_type: "product",
                },
              },
            ],
          }),
          signal: controller.signal,
        },
      )
    } finally {
      clearTimeout(timer)
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "")
      const error = `http_${res.status}: ${errText}`
      await recordDelivery({
        eventId: params.eventId,
        source: params.source,
        ok: false,
        error,
        dedupedLocally: false,
        saleDate: params.saleDate,
      })
      return { ok: false, error }
    }

    // Se marca DESPUÉS de la respuesta 2xx de Meta, nunca antes — si esto
    // fallara, preferimos arriesgar un reintento futuro (que Meta va a
    // deduplicar de todas formas) antes que marcar "enviado" un evento que
    // en realidad nunca llegó.
    try {
      await getStore(ALREADY_SENT_STORE).set(params.eventId, "1")
    } catch (err) {
      console.error("[metaCapi] no se pudo marcar el evento como enviado:", err)
    }

    await recordDelivery({
      eventId: params.eventId,
      source: params.source,
      ok: true,
      dedupedLocally: false,
      saleDate: params.saleDate,
    })
    return { ok: true }
  } catch (err) {
    const error = String(err)
    await recordDelivery({
      eventId: params.eventId,
      source: params.source,
      ok: false,
      error,
      dedupedLocally: false,
      saleDate: params.saleDate,
    })
    return { ok: false, error }
  }
}
