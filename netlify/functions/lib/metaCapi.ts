// Cliente para la API de Conversiones de Meta (server-side), compartido por
// todos los caminos que le mandan un evento de Compra a Meta desde el
// servidor: mp-webhook.mts (Mercado Pago), capi-confirmar-pago.mts
// (transferencia/binance, al momento en que el admin confirma el
// comprobante) y capi-venta-manual.mts (ventas cerradas 100% por WhatsApp,
// sin reserva en el sitio).
import { getStore } from "@netlify/blobs"
import { recordDelivery, type DeliverySource } from "./deliveryLog"
import { logMetaResponse } from "./metaResponseLog"
import { PACKS } from "../../../src/lib/packs"
import type { Pack } from "../../../src/types/order"
import { META_PIXEL_ID } from "./metaPixelId"

const ALREADY_SENT_STORE = "capi-events-sent"
// Identifica la integración ante Meta (recomendado por su spec de CAPI).
const PARTNER_AGENT = "kunzera-web"

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
  // Email del comprador. Meta lo espera hasheado (SHA-256) como `em`, pero
  // ANTES de hashear pide normalizarlo: minúsculas y sin espacios al borde
  // (spec de Advanced Matching). A diferencia de fn/ln NO se le sacan
  // acentos — un email es ASCII y "normalizar de más" solo rompería el
  // match. Es la señal que más sube la calidad de coincidencia en ventas
  // por WhatsApp, donde no hay cookie de navegador (fbc/fbp) para aportar.
  email?: string
  // Contexto del comprador capturado en el momento de la reserva (ver
  // lib/attribution.ts) — NUNCA se hashean (a diferencia de teléfono/
  // nombre/email). fbc solo debe venir seteado si existía un fbclid/cookie
  // _fbc real; nunca se inventa acá ni en el caller.
  fbp?: string
  fbc?: string
  clientIpAddress?: string
  clientUserAgent?: string
  // Geolocalización aproximada (ver lib/attribution.ts, resuelta gratis por
  // Netlify desde la IP) — a diferencia de fbp/fbc/ip/ua, Meta SÍ espera
  // ct/st/zp/country hasheados, igual que teléfono/nombre.
  city?: string
  region?: string
  postalCode?: string
  countryCode?: string
  // ID propio y estable del navegador del comprador (ver src/lib/visitorId.ts),
  // capturado en el momento de la reserva (lib/attribution.ts → visitorId).
  // Meta lo espera hasheado, igual que teléfono/nombre. Es el mismo id que
  // manda el PageView server-side, así que deja unir esta compra con la
  // visita anónima que la originó. Ausente en ventas manuales (sin navegador).
  externalId?: string
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
    if (params.email) {
      // minúsculas + trim antes de hashear (ver comentario en el tipo).
      userData.em = [await sha256Hex(params.email.trim().toLowerCase())]
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
    // Geolocalización aproximada (gratis, no pedida al cliente) — Meta SÍ
    // espera estos hasheados, a diferencia de fbp/fbc/ip/ua de más abajo.
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
    if (params.externalId) {
      userData.external_id = [await sha256Hex(params.externalId.trim().toLowerCase())]
    }
    // Campos sin hash — Meta los espera en texto plano, no como PII hasheada.
    const rawUserData: Record<string, string> = {}
    if (params.fbp) rawUserData.fbp = params.fbp
    if (params.fbc) rawUserData.fbc = params.fbc
    if (params.clientIpAddress) rawUserData.client_ip_address = params.clientIpAddress
    if (params.clientUserAgent) rawUserData.client_user_agent = params.clientUserAgent

    const contentPrettyName = params.contentName
      ? PACKS[params.contentName as Pack]?.name ?? params.contentName
      : undefined
    const payload = JSON.stringify({
      // Si está seteado META_CAPI_TEST_EVENT_CODE, TODOS los eventos de
      // este deploy caen en la pestaña "Eventos de prueba" de Meta: no
      // se cuentan como conversión, no se atribuyen a ninguna campaña y
      // no ensucian el aprendizaje. Se usa SOLO en el deploy de prueba
      // (la variable está atada al contexto deploy-preview, nunca a
      // producción), para poder cargar ventas de prueba de punta a
      // punta contra el Meta real sin impacto.
      ...(process.env.META_CAPI_TEST_EVENT_CODE
        ? { test_event_code: process.env.META_CAPI_TEST_EVENT_CODE }
        : {}),
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
          partner_agent: PARTNER_AGENT,
          user_data: { ...userData, ...rawUserData },
          custom_data: {
            currency: "ARS",
            value: params.value,
            // contentName llega de los callers como el slug interno
            // ("platino"/"diamante") — content_name usa el nombre
            // visible del pack para que el reporting de Meta sea
            // legible; content_ids conserva el slug (identificador
            // estable) para que Meta pueda agrupar conversiones por
            // producto.
            content_name: contentPrettyName,
            content_ids: params.contentName ? [params.contentName] : undefined,
            content_type: "product",
            // Formato "rico" que Meta prefiere para el detalle del producto:
            // el mismo slug/precio que content_ids/value, pero como array de
            // items. Ayuda al reporting por producto y a la optimización por
            // valor.
            contents: params.contentName
              ? [{ id: params.contentName, quantity: 1, item_price: params.value }]
              : undefined,
            order_id: params.eventId,
            num_items: 1,
          },
        },
      ],
    })
    const url = `https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(accessToken)}`

    // Reintento acotado. La Graph API tira 5xx transitorios y cortes de
    // conexión cada tanto; antes un solo intento fallido dejaba la venta sin
    // avisar a Meta para siempre (transferencia/binance no tienen reintento
    // externo como el webhook de Mercado Pago, ni botón manual como las
    // ventas de WhatsApp). Se reintenta SÓLO ante error de red o 5xx — un 4xx
    // (token vencido, payload inválido, evento fuera de la ventana de 7 días)
    // no se arregla reintentando. Presupuesto total ~7s para no pasarnos del
    // límite de ejecución de la función: este es el último paso de
    // mp-webhook.mts y capi-confirmar-pago.mts.
    const RETRY_BUDGET_MS = 7000
    const MAX_ATTEMPTS = 3
    const startedAt = Date.now()
    let res: Response | null = null
    let lastError = "sin_respuesta"

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        if (RETRY_BUDGET_MS - (Date.now() - startedAt) < 1200) break
        await new Promise((r) => setTimeout(r, Math.min(250 * 2 ** (attempt - 2), 1000)))
      }
      const perAttempt = Math.min(6000, RETRY_BUDGET_MS - (Date.now() - startedAt))
      if (perAttempt < 1000) break
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), perAttempt)
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: controller.signal,
        })
        if (r.ok) {
          res = r
          break
        }
        const errText = await r.text().catch(() => "")
        lastError = `http_${r.status}: ${errText}`
        if (r.status < 500) {
          // 4xx: no se arregla reintentando — se corta acá con el error.
          res = r
          break
        }
        // 5xx: sigue el loop (si queda presupuesto).
      } catch (err) {
        // Error de red o abort por timeout: sigue el loop.
        lastError = String(err)
      } finally {
        clearTimeout(timer)
      }
    }

    if (!res || !res.ok) {
      await recordDelivery({
        eventId: params.eventId,
        source: params.source,
        ok: false,
        error: lastError,
        dedupedLocally: false,
        saleDate: params.saleDate,
      })
      return { ok: false, error: lastError }
    }

    // Respuesta 2xx: loguear advertencias del cuerpo (parámetros ignorados,
    // events_received=0) que antes se tiraban.
    await logMetaResponse(res, "metaCapi:Purchase")

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
