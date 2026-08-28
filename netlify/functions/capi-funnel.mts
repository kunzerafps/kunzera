import type { Config, Context } from "@netlify/functions"
import { sendMetaFunnelEvent, FUNNEL_EVENTS, type FunnelEventName } from "./lib/metaCapiFunnel"
import { isRateLimited } from "./lib/rateLimit"

const KEY_RE = /^[a-zA-Z0-9-]{6,80}$/
const RATE_LIMIT_MAX = 40
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
      value: typeof body.value === "number" && Number.isFinite(body.value) ? body.value : undefined,
      currency: str(body.currency),
      contentName: str(body.contentName),
      contentIds: strArray(body.contentIds),
      contentType: str(body.contentType),
    })
  } catch (err) {
    console.error("[capi-funnel] error inesperado:", err)
  }

  return new Response(null, { status: 200 })
}

export const config: Config = {
  path: "/api/capi-funnel",
}
