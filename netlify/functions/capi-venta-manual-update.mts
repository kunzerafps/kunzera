import type { Config, Context } from "@netlify/functions"
import { verifySessionToken } from "./lib/adminSession"
import { sendMetaPurchaseEvent, MAX_EVENT_AGE_DAYS } from "./lib/metaCapi"
import { isRateLimited } from "./lib/rateLimit"
import { getManualSaleByEvent, updateManualSaleByEvent } from "./lib/manualSalesStore"

// Acciones sobre una venta ya registrada (ver lib/manualSalesStore.ts):
//   - "cancel"      -> marca la venta como caída (el cliente se arrepintió).
//   - "reactivate"  -> deshace lo anterior.
//   - "retry-meta"  -> reintenta el aviso a Meta de una venta que quedó en
//                      estado "error". Reconstruye el evento desde el
//                      registro (no confía en nada que mande el cliente
//                      salvo el eventId y la acción).
type Body = {
  token?: string
  eventId?: string
  action?: "cancel" | "reactivate" | "retry-meta"
}

const RATE_LIMIT_MAX = 60
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

// Argentina es UTC-3 fijo — mismo criterio que capi-venta-manual.mts.
function todayInArgentina(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
function daysAgoInArgentina(days: number): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000 - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 })
  }

  if (await isRateLimited("capi-venta-manual-update-rate-limit", ctx.ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
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

  const eventId = (body.eventId || "").trim()
  if (!eventId) {
    return Response.json({ ok: false, error: "missing_event_id" }, { status: 400 })
  }

  const venta = await getManualSaleByEvent(eventId)
  if (!venta) {
    return Response.json({ ok: false, error: "no_encontrada" }, { status: 404 })
  }

  if (body.action === "cancel") {
    const updated = await updateManualSaleByEvent(eventId, { canceled: true })
    return Response.json({ ok: true, venta: updated })
  }

  if (body.action === "reactivate") {
    const updated = await updateManualSaleByEvent(eventId, { canceled: false })
    return Response.json({ ok: true, venta: updated })
  }

  if (body.action === "retry-meta") {
    if (venta.metaStatus === "ok") {
      // Ya está enviada — no se reintenta (Meta la deduplicaría igual, pero
      // no tiene sentido gastar la llamada ni confundir el estado).
      return Response.json({ ok: true, venta, noop: true })
    }

    // La ventana de 7 días de Meta se mide contra HOY, no contra cuándo se
    // cargó: una venta que quedó en "error" hace más de una semana ya no se
    // puede reintentar.
    if (venta.saleDate < daysAgoInArgentina(MAX_EVENT_AGE_DAYS)) {
      return Response.json({ ok: false, error: "fecha_muy_vieja" }, { status: 400 })
    }

    const eventTimeMidday = Math.floor(new Date(`${venta.saleDate}T15:00:00Z`).getTime() / 1000)
    const eventTime = Math.min(eventTimeMidday, Math.floor(Date.now() / 1000))

    const result = await sendMetaPurchaseEvent({
      eventId: venta.metaEventId,
      source: "venta_manual",
      actionSource: "business_messaging",
      value: venta.monto,
      contentName: venta.pack,
      whatsapp: venta.whatsapp,
      nombre: venta.nombre,
      email: venta.email,
      countryCode: "ar",
      eventTime,
      saleDate: venta.saleDate,
    })

    const updated = await updateManualSaleByEvent(eventId, {
      metaStatus: result.ok ? "ok" : "error",
      metaError: result.ok ? undefined : result.error,
    })
    return Response.json(
      { ok: result.ok, venta: updated, metaError: result.ok ? undefined : result.error },
      { status: result.ok ? 200 : 502 },
    )
  }

  return Response.json({ ok: false, error: "accion_invalida" }, { status: 400 })
}

export const config: Config = {
  path: "/api/capi-venta-manual-update",
}
