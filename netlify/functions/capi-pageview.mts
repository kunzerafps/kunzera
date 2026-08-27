import type { Config, Context } from "@netlify/functions"
import { sendMetaPageViewEvent } from "./lib/metaCapiPageView"
import { isRateLimited } from "./lib/rateLimit"

const KEY_RE = /^[a-zA-Z0-9-]{6,80}$/
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

type Body = {
  eventId?: string
  fbp?: string
  fbc?: string
  externalId?: string
}

// Respaldo server-side del PageView del navegador (ver useServerPageView.ts
// / index.html) — mismo criterio de "nunca romperle la experiencia a nadie"
// que capture-attribution.mts: sin sesión admin, siempre 200, falla en
// silencio hacia el cliente.
export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response(null, { status: 200 })
  }

  if (await isRateLimited("capi-pageview-rate-limit", ctx.ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
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

  try {
    await sendMetaPageViewEvent({
      eventId: body.eventId,
      fbp: typeof body.fbp === "string" && body.fbp ? body.fbp : undefined,
      fbc: typeof body.fbc === "string" && body.fbc ? body.fbc : undefined,
      externalId:
        typeof body.externalId === "string" && body.externalId
          ? body.externalId.slice(0, 200)
          : undefined,
      clientIpAddress: ctx.ip || undefined,
      clientUserAgent: req.headers.get("user-agent") || undefined,
    })
  } catch (err) {
    console.error("[capi-pageview] error inesperado:", err)
  }

  return new Response(null, { status: 200 })
}

export const config: Config = {
  path: "/api/capi-pageview",
}
