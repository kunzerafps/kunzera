import type { Config, Context } from "@netlify/functions"
import { verifySessionToken } from "./lib/adminSession"
import { sendMetaPurchaseEvent, normalizePhoneForHash, MAX_EVENT_AGE_DAYS } from "./lib/metaCapi"
import { notifyDiscord } from "./lib/discordAlert"
import { isRateLimited } from "./lib/rateLimit"

type Body = {
  token?: string
  nombre?: string
  whatsapp?: string
  monto?: number | string
  pack?: string
  fecha?: string // YYYY-MM-DD, opcional — default hoy (hora Argentina)
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/
const RATE_LIMIT_MAX = 30
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

// Argentina es UTC-3 fijo (sin horario de verano desde 2009) — restar 3hs
// antes de cortar la fecha evita que, entre las 21:00 y 23:59 hora local,
// "hoy" se calcule mal como el día siguiente en UTC.
function todayInArgentina(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function daysAgoInArgentina(days: number): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000 - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

// Determinístico por (teléfono, monto, día): si el admin carga la misma
// venta dos veces sin querer el mismo día, Meta la deduplica sola contra el
// event_id repetido en vez de contarla dos veces — no hace falta ningún
// store extra para eso. Contrapartida conocida y aceptada: si el mismo
// cliente compra dos veces de verdad el mismo día por el mismo monto, la
// segunda queda absorbida como "duplicado" — casuística rara, no hay forma
// de distinguirla sin guardar más estado del que vale la pena para este caso.
async function offlineEventId(whatsapp: string, monto: number, fecha: string): Promise<string> {
  const data = new TextEncoder().encode(
    `offline-${normalizePhoneForHash(whatsapp)}-${monto}-${fecha}`,
  )
  const hash = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

// Ventas que se cierran 100% por WhatsApp, sin que el cliente pase nunca por
// el sitio — hoy no dejan ningún rastro (ni reserva, ni comprobante, ni
// idempotencyKey), así que Meta jamás se entera de que existieron pese a que
// muchas sí vienen de un anuncio. Este endpoint SOLO manda el evento de
// Compra a Meta como conversión cerrada por mensajería (action_source
// "business_messaging", la categoría que Meta define específicamente para
// esto) — a propósito no toca el Sheet de reservas ni Apps Script, esto es
// puramente para que el algoritmo de Meta sepa que la venta pasó.
export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 })
  }

  if (await isRateLimited("capi-venta-manual-rate-limit", ctx.ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
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

  const monto = Number(body.monto)
  const whatsappDigits = (body.whatsapp || "").replace(/\D/g, "")
  if (!body.nombre?.trim() || whatsappDigits.length < 8 || !monto || monto <= 0) {
    return Response.json({ ok: false, error: "missing_field" }, { status: 400 })
  }

  const fecha = body.fecha && FECHA_RE.test(body.fecha) ? body.fecha : todayInArgentina()
  // FECHA_RE solo valida la FORMA (4 dígitos-2 dígitos-2 dígitos) — algo
  // como "2026-13-45" la pasa igual pero no es una fecha real.
  if (Number.isNaN(new Date(`${fecha}T15:00:00Z`).getTime())) {
    return Response.json({ ok: false, error: "fecha_invalida" }, { status: 400 })
  }
  const hoy = todayInArgentina()
  if (fecha > hoy) {
    return Response.json({ ok: false, error: "fecha_futura" }, { status: 400 })
  }
  if (fecha < daysAgoInArgentina(MAX_EVENT_AGE_DAYS)) {
    // Meta rechaza el batch entero si event_time supera esta ventana — mejor
    // frenarlo acá con un error claro que dejar que se pierda en silencio.
    return Response.json({ ok: false, error: "fecha_muy_vieja" }, { status: 400 })
  }

  // Mediodía del día indicado, en hora Argentina (UTC-3): alcanza para que
  // Meta ubique el evento en el día correcto sin depender de a qué hora
  // exacta se cargó a mano. PERO si "hoy" es el día elegido y todavía no
  // llegó el mediodía en Argentina, ese cálculo da una hora que aún no pasó
  // — y Meta rechaza cualquier event_time en el futuro (error real,
  // encontrado probando esto: "La marca de tiempo del evento es posterior a
  // la actual"). Nunca se manda más adelante que "ahora mismo".
  const eventTimeMidday = Math.floor(new Date(`${fecha}T15:00:00Z`).getTime() / 1000)
  const eventTime = Math.min(eventTimeMidday, Math.floor(Date.now() / 1000))
  const eventId = await offlineEventId(body.whatsapp!, monto, fecha)

  const result = await sendMetaPurchaseEvent({
    eventId,
    source: "venta_manual",
    actionSource: "business_messaging",
    value: monto,
    contentName: body.pack,
    whatsapp: body.whatsapp,
    nombre: body.nombre,
    eventTime,
    saleDate: fecha,
  })

  if (!result.ok) {
    console.error("[capi-venta-manual] error mandando evento a Meta:", result.error)
    await notifyDiscord(
      `capi-manual-${eventId}`,
      `⚠️ **No se pudo cargar una venta manual a Meta** (${body.nombre}, $${monto})\n${result.error}`,
    )
  }

  return Response.json(result)
}

export const config: Config = {
  path: "/api/capi-venta-manual",
}
