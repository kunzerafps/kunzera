import type { Config, Context } from "@netlify/functions"
import { sendMetaFunnelEvent, FUNNEL_EVENTS, type FunnelEventName } from "./lib/metaCapiFunnel"
import { isRateLimited } from "./lib/rateLimit"
import { savePhoneAttribution } from "./lib/attribution"
import { normalizePhoneForHash, sha256Hex } from "./lib/metaUserData"
import { getServerPackPricesArs, isPackSlug } from "./lib/packPrices"

const KEY_RE = /^[a-zA-Z0-9-]{6,80}$/
// Antes 40. Con ViewContent + AddToCart yendo server-side, casi toda visita
// gasta ≥1 request — 40/hora por IP quedaba corto para redes de celular
// compartidas (CGNAT), donde una ráfaga podía dejar sin la copia server-side
// a un comprador real detrás de esa misma IP.
const RATE_LIMIT_MAX = 150
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000
const MAX_STR = 200

type Body = {
  eventId?: string
  event?: string
  whatsapp?: string
  nombre?: string
  externalId?: string
  fbp?: string
  fbc?: string
  value?: number
  currency?: string
  contentName?: string
  contentIds?: unknown
  contentType?: string
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v.slice(0, MAX_STR) : undefined
}

// Hasta 5 ids de contenido, string, cada uno acotado — evita que un cliente
// manipulado mande un array gigante.
function strArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.filter((x): x is string => typeof x === "string" && !!x).slice(0, 5).map((x) => x.slice(0, MAX_STR))
  return out.length > 0 ? out : undefined
}

// Respaldo server-side de los eventos Lead / InitiateCheckout del navegador
// (ver src/lib/pixel.ts → trackServerBackedEvent). Mismo criterio que
// capi-pageview.mts / capture-attribution.mts: endpoint público, sin sesión
// admin, SIEMPRE responde 200 y falla en silencio hacia el cliente — un
// problema de tracking nunca debe romperle la experiencia a nadie.
export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response(null, { status: 200 })
  }

  if (await isRateLimited("capi-funnel-rate-limit", ctx.ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    return new Response(null, { status: 200 })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return new Response(null, { status: 200 })
  }

  if (!body.eventId || !KEY_RE.test(body.eventId)) {
    return new Response(null, { status: 200 })
  }

  if (!body.event || !FUNNEL_EVENTS.includes(body.event as FunnelEventName)) {
    return new Response(null, { status: 200 })
  }

  // El monto NUNCA se toma de lo que manda el navegador: este endpoint es
  // público y sin contraseña, así que cualquiera podía postear "dejó los
  // datos" por $999.999.999 y ensuciarle a Meta la optimización por valor.
  // Se resuelve del lado del servidor a partir del pack, contra los precios
  // reales del panel (ver lib/packPrices.ts). Si el evento no trae un pack
  // conocido, va SIN monto — mejor un evento sin valor que con uno inventado.
  // EXACTAMENTE un pack: la sección de precios manda los dos
  // (`["platino","diamante"]`, un ViewContent de "vio la lista"), y ahí no
  // hay un monto único honesto — mejor sin `value` que con uno inventado.
  const contentIds = strArray(body.contentIds)
  const packSlugs = contentIds?.filter(isPackSlug) ?? []
  // `content_ids` es lo que agrupa públicos y catálogo en Meta, y este
  // endpoint es público: se manda SÓLO lo que el servidor reconoce como pack.
  const safeContentIds = packSlugs.length > 0 ? packSlugs : undefined
  // Si mandó content_ids y ninguno era un pack, tampoco se le cree el
  // content_name: la rama de compatibilidad de metaCapiFunnel fabrica
  // `content_ids = [contentName]` cuando no hay ids, y la basura volvería a
  // entrar por la ventana. Contact no se toca: ahí el contentName es de DÓNDE
  // tocaron WhatsApp y nunca se convierte en content_ids.
  const safeContentName = contentIds && !safeContentIds ? undefined : str(body.contentName)
  const serverValue =
    packSlugs.length === 1 ? (await getServerPackPricesArs())[packSlugs[0]] : undefined

  try {
    await sendMetaFunnelEvent({
      eventId: body.eventId,
      eventName: body.event as FunnelEventName,
      whatsapp: str(body.whatsapp),
      nombre: str(body.nombre),
      externalId: str(body.externalId),
      fbp: str(body.fbp),
      fbc: str(body.fbc),
      clientIpAddress: ctx.ip || undefined,
      clientUserAgent: req.headers.get("user-agent") || undefined,
      // Geo que Netlify ya resolvió en el edge desde la IP — gratis, no se le
      // pide nada al cliente. `subdivision.name` (no `.code`), igual criterio
      // que capture-attribution.mts para el evento de Compra.
      city: ctx.geo?.city || undefined,
      region: ctx.geo?.subdivision?.name || undefined,
      postalCode: ctx.geo?.postalCode || undefined,
      countryCode: ctx.geo?.country?.code || undefined,
      value: serverValue,
      // La moneda también se fija acá: si el monto lo pone el servidor, la
      // moneda no puede venir del cliente.
      currency: serverValue !== undefined ? "ARS" : undefined,
      contentName: safeContentName,
      contentIds: safeContentIds,
      contentType: str(body.contentType),
    })
  } catch (err) {
    console.error("[capi-funnel] error inesperado:", err)
  }

  // Índice teléfono → rastro del anuncio. Se guarda cuando la persona YA dejó
  // su teléfono en el sitio (evento Lead) y hay algo del anuncio que valga la
  // pena conservar. Sirve para cuando esa misma persona termina cerrando por
  // WhatsApp y la venta se carga a mano: sin esto, esa Compra le llega a Meta
  // sin fbc/fbp/IP/id de visitante y no se puede atribuir a ninguna campaña.
  //
  // La clave va hasheada, así el store no expone teléfonos de clientes.
  // Best-effort y después de mandar el evento: si falla, no afecta nada.
  const phone = str(body.whatsapp)
  if (phone && (body.fbc || body.fbp || body.externalId)) {
    try {
      const phoneKey = await sha256Hex(normalizePhoneForHash(phone))
      await savePhoneAttribution(phoneKey, {
        fbp: str(body.fbp),
        fbc: str(body.fbc),
        ip: ctx.ip || undefined,
        userAgent: req.headers.get("user-agent") || undefined,
        city: ctx.geo?.city || undefined,
        region: ctx.geo?.subdivision?.name || undefined,
        postalCode: ctx.geo?.postalCode || undefined,
        countryCode: ctx.geo?.country?.code || undefined,
        visitorId: str(body.externalId),
        capturedAt: Date.now(),
      })
    } catch (err) {
      console.error("[capi-funnel] no se pudo indexar por teléfono:", err)
    }
  }

  return new Response(null, { status: 200 })
}

export const config: Config = {
  path: "/api/capi-funnel",
}
