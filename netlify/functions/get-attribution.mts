import type { Config, Context } from "@netlify/functions"
import { verifySessionToken } from "./lib/adminSession"
import { getAttribution } from "./lib/attribution"
import { isRateLimited } from "./lib/rateLimit"

type Body = {
  token?: string
  idempotencyKey?: string
}

const KEY_RE = /^[a-zA-Z0-9-]{6,80}$/
const RATE_LIMIT_MAX = 120
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

// Lee, para una reserva puntual, de qué campaña vino (si el link traía
// utm_source) — mismo store que ya usa capture-attribution.mts para
// fbp/fbc, solo que acá se expone al panel admin en vez de mandarse a Meta.
// A propósito nunca devuelve ip/userAgent: eso es solo para el matching con
// Meta, no algo que el panel necesite mostrar.
export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 })
  }

  if (await isRateLimited("get-attribution-rate-limit", ctx.ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return Response.json({ ok: false, error: "invalid_body" }, { status: 400 })
  }

  if (!verifySessionToken(body.token)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }

  if (!body.idempotencyKey || !KEY_RE.test(body.idempotencyKey)) {
    return Response.json({ ok: false, error: "missing_field" }, { status: 400 })
  }

  const attribution = await getAttribution(body.idempotencyKey)
  return Response.json({
    ok: true,
    utmSource: attribution?.utmSource,
    utmMedium: attribution?.utmMedium,
    utmCampaign: attribution?.utmCampaign,
  })
}

export const config: Config = {
  path: "/api/get-attribution",
}
