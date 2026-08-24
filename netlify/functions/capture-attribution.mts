import type { Config, Context } from "@netlify/functions"
import { saveAttribution } from "./lib/attribution"
import { isRateLimited } from "./lib/rateLimit"

const KEY_RE = /^[a-zA-Z0-9-]{6,80}$/
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

const MAX_UTM_LEN = 100

function cleanUtm(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim().slice(0, MAX_UTM_LEN)
  return trimmed || undefined
}

type Body = {
  idempotencyKey?: string
  fbp?: string
  fbc?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
}

// Se llama UNA vez, apenas el cliente entra a la pantalla de pago (ver
// PaymentStep.tsx, mismo momento en que se decide el idempotencyKey) — antes
// de elegir Mercado Pago/transferencia/Binance, así que cubre las 3 formas
// de pago con un solo punto de captura. Guarda la IP y el user-agent que
// Netlify observa en ESTE request (el del comprador, real) más las cookies
// _fbp/_fbc que el propio píxel de Meta ya puso en el navegador — nunca
// inventa fbc si no existe _fbc real. Sin sesión admin: lo llama cualquier
// visitante anónimo del sitio, como cualquier otro endpoint público de
// tracking. Falla en silencio hacia el cliente (siempre 200) — no es motivo
// para romperle la experiencia de pago a nadie.
export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response(null, { status: 200 })
  }

  if (await isRateLimited("capture-attribution-rate-limit", ctx.ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    return new Response(null, { status: 200 })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return new Response(null, { status: 200 })
  }

  if (!body.idempotencyKey || !KEY_RE.test(body.idempotencyKey)) {
    return new Response(null, { status: 200 })
  }

  try {
    await saveAttribution(body.idempotencyKey, {
      fbp: typeof body.fbp === "string" && body.fbp ? body.fbp : undefined,
      fbc: typeof body.fbc === "string" && body.fbc ? body.fbc : undefined,
      // ctx.ip es la IP que Netlify ya resolvió en el edge — a diferencia de
      // un header tipo x-forwarded-for, quien hace el request no la puede
      // falsificar.
      ip: ctx.ip || undefined,
      userAgent: req.headers.get("user-agent") || undefined,
      utmSource: cleanUtm(body.utm_source),
      utmMedium: cleanUtm(body.utm_medium),
      utmCampaign: cleanUtm(body.utm_campaign),
      capturedAt: Date.now(),
    })
  } catch (err) {
    console.error("[capture-attribution] no se pudo guardar:", err)
  }

  return new Response(null, { status: 200 })
}

export const config: Config = {
  path: "/api/capture-attribution",
}
