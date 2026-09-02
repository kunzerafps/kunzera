import type { Config, Context } from "@netlify/functions"
import { verifySessionToken } from "./lib/adminSession"
import { sendMetaPurchaseEvent, MAX_EVENT_AGE_DAYS } from "./lib/metaCapi"
import { sendConfirmedBookingScheduleEvent } from "./lib/metaCapiFunnel"
import { notifyDiscord } from "./lib/discordAlert"
import { isRateLimited } from "./lib/rateLimit"
import { getAttribution } from "./lib/attribution"
import { getPaymentMethod } from "./lib/facturacion"
import { updateOrderStatus } from "../../src/lib/appsScript"

type Body = {
  token?: string
  idempotencyKey?: string
  nombre?: string
  whatsapp?: string
  plan?: string
  monto?: number | string
  // Timestamp de creación de la reserva (order.timestamp) — es el momento
  // verificable más cercano a cuándo el cliente realmente pagó (subió el
  // comprobante ahí), a diferencia de cuándo el admin apretó "Confirmar
  // pago", que puede ser horas o días después y no tiene relación con
  // cuándo ocurrió la compra real.
  reservaTimestamp?: string
  // Si viene true, además del aviso a Meta este endpoint marca la reserva
  // como "atendido" en la planilla — así el botón "Marcar como atendido" del
  // panel es UNA sola llamada al servidor y no dos desde el navegador que se
  // pueden cortar por la mitad (pestaña cerrada, sesión vencida). Cuando es
  // false/ausente, solo reintenta el aviso a Meta sin tocar el estado (lo
  // usa el botón "Reintentar aviso a Meta" y el barrido automático del
  // panel).
  markAtendido?: boolean
}

// Política de event_time para transferencia/binance: se usa el momento en
// que se CREÓ la reserva (cliente subió comprobante), no el momento en que
// el admin la confirma. Si esa fecha ya superó la ventana de 7 días que
// tolera la Conversions API, usar igual esa fecha haría que Meta rechace el
// evento ENTERO — mejor mandar el evento con "ahora" (perdiendo precisión
// en el timestamp) que perder la señal de venta por completo.
function resolveEventTime(reservaTimestamp: string | undefined): number | undefined {
  if (!reservaTimestamp) return undefined
  const ms = Date.parse(reservaTimestamp)
  if (Number.isNaN(ms)) return undefined
  const ageDays = (Date.now() - ms) / (24 * 60 * 60 * 1000)
  if (ageDays > MAX_EVENT_AGE_DAYS || ageDays < 0) return undefined
  return Math.floor(ms / 1000)
}

// 60/hora por IP: el panel admin ahora puede disparar hasta 15 reintentos
// de golpe (barrido al abrir) además de los clicks manuales de "marcar
// atendido" / "reintentar aviso". Todo desde la misma IP del admin.
const RATE_LIMIT_MAX = 60
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

// Único punto donde transferencia/binance le mandan a Meta un evento de
// Compra server-side — lo llama OrderDetailModal.tsx justo después de que
// "Confirmar pago" marca la reserva como revisada de verdad. Es la ÚNICA
// fuente del evento de Compra para estas dos formas de pago — el píxel del
// navegador para "Compra" se sacó del todo (ver useChatFlow.ts): la
// deduplicación de Meta por event_id solo funciona dentro de una ventana de
// 48hs, y el admin puede tardar más que eso en confirmar un comprobante, así
// que depender de esa dedup habría contado ventas dos veces en vez de una.
export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 })
  }

  if (await isRateLimited("capi-confirmar-pago-rate-limit", ctx.ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
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

  if (!body.idempotencyKey || !body.nombre || body.monto === undefined) {
    return Response.json({ ok: false, error: "missing_field" }, { status: 400 })
  }

  // Marcar "atendido" en la planilla ANTES del aviso a Meta y desde acá (no
  // desde el navegador). Es lo que le importa al admin ("marcar atendido"
  // siempre tiene que funcionar); el aviso a Meta va después y si falla lo
  // levanta el barrido del panel / el botón "Reintentar". Antes esto eran
  // DOS llamadas separadas desde OrderDetailModal.tsx y una pestaña cerrada
  // entre medio dejaba la reserva atendida sin avisar a Meta y sin forma de
  // reintentar.
  let statusOk: boolean | undefined
  let statusError: string | undefined
  if (body.markAtendido) {
    const st = await updateOrderStatus(body.idempotencyKey, "atendido")
    statusOk = st.ok
    if (!st.ok) {
      statusError = st.error
      console.error("[capi-confirmar-pago] no se pudo marcar atendido:", body.idempotencyKey, st.error)
    }
  }

  // Política de valor: precio real de la reserva (transferencia/binance no
  // tienen comisión de medio de pago como Mercado Pago — lo que el cliente
  // transfirió/mandó en USDT es exactamente order.monto). Mismo criterio
  // conceptual que Mercado Pago (precio del servicio, no un costo de
  // procesamiento), y acá coincide 1 a 1 porque no hay comisión que restar.
  //
  // Este endpoint también se llama para reservas de Mercado Pago (el botón
  // "Marcar como atendido" del panel dispara este mismo fetch para
  // cualquier reserva, MP incluido — ver OrderDetailModal.tsx). El evento
  // en sí no se duplica (sendMetaPurchaseEvent dedupea por eventId), pero
  // el `source` que queda en el log de entregas SÍ hay que resolverlo bien
  // acá, o una venta real de MP queda etiquetada como transferencia para
  // siempre en capi-delivery-log — dato de auditoría corrupto, aunque no
  // afecta lo que le llega a Meta.
  const metodo = await getPaymentMethod(body.idempotencyKey)
  const source = metodo === "mercadopago" ? "mercadopago" : "transferencia_binance"
  const attribution = await getAttribution(body.idempotencyKey)

  // event_time real de la venta: el momento en que se creó la reserva (cliente
  // subió el comprobante), NO cuando el admin aprieta "Confirmar pago", que
  // puede ser días después. Se comparte entre Purchase y Schedule para que
  // los dos eventos de esta misma venta caigan en la misma ventana de
  // atribución de Meta. `undefined` si la reserva ya superó los 7 días (Meta
  // rechazaría el evento) → cae a "ahora" adentro de sendMeta*.
  const eventTime = resolveEventTime(body.reservaTimestamp)

  // "Schedule" (reserva confirmada) — antes se disparaba desde el navegador al
  // volver de Mercado Pago con "?mp=success", antes de que el pago estuviera
  // realmente confirmado. Se dispara EN PARALELO al Purchase (no en serie).
  // event_id + store de dedup propios: si este endpoint se llama sobre una
  // reserva de MP (botón "Marcar como atendido"), deduplica contra el que ya
  // mandó mp-webhook.mts. Sin alerta: señal blanda, la Compra ya avisa si falla.
  const schedulePromise = sendConfirmedBookingScheduleEvent({
    idempotencyKey: body.idempotencyKey,
    value: Number(body.monto),
    contentName: body.plan,
    whatsapp: body.whatsapp,
    nombre: body.nombre,
    fbp: attribution?.fbp,
    fbc: attribution?.fbc,
    clientIpAddress: attribution?.ip,
    clientUserAgent: attribution?.userAgent,
    city: attribution?.city,
    region: attribution?.region,
    postalCode: attribution?.postalCode,
    countryCode: attribution?.countryCode,
    externalId: attribution?.visitorId,
    eventTime,
  }).catch((err) => {
    console.error("[capi-confirmar-pago] error mandando Schedule a Meta:", err)
    return { ok: false as const, error: String(err) }
  })

  const result = await sendMetaPurchaseEvent({
    eventId: body.idempotencyKey,
    source,
    actionSource: "website",
    value: Number(body.monto),
    contentName: body.plan,
    whatsapp: body.whatsapp,
    nombre: body.nombre,
    // Mail que la persona dejó en el chat (paso opcional). Viene del blob de
    // atribución y no del Sheet, porque el campo `email` del Apps Script es
    // un honeypot anti-spam (Code.gs:108). Es la señal que más sube la
    // calidad de coincidencia de Meta y la que más faltaba: este camino
    // (transferencia/Binance) es la mayoría de las ventas y no mandaba `em`
    // en ninguna.
    email: attribution?.email,
    fbp: attribution?.fbp,
    fbc: attribution?.fbc,
    clientIpAddress: attribution?.ip,
    clientUserAgent: attribution?.userAgent,
    city: attribution?.city,
    region: attribution?.region,
    postalCode: attribution?.postalCode,
    countryCode: attribution?.countryCode,
    externalId: attribution?.visitorId,
    eventTime,
  })

  if (!result.ok) {
    console.error("[capi-confirmar-pago] error mandando evento a Meta:", result.error)
    // Namespace "capi-" separado del resto de los avisos de mp-webhook —
    // mismo store de Discord, pero es un problema de tracking, no de la
    // reserva (que ya quedó confirmada antes de llegar acá).
    await notifyDiscord(
      `capi-${body.idempotencyKey}`,
      `⚠️ **No se pudo mandar el evento de Compra a Meta** (reserva ${body.idempotencyKey.slice(0, 8)}…, ${source})\nLa reserva está bien confirmada — esto solo afecta el tracking de anuncios.\n${result.error}`,
    )
  }

  await schedulePromise

  // Siempre 200 con el resultado: un fallo de tracking no debe bloquear ni
  // reintentar como si fuera un error de la reserva en sí — ya se avisó
  // por Discord arriba. `metaOk` = si la Compra le llegó a Meta;
  // `statusOk` = si se marcó "atendido" (solo presente cuando markAtendido).
  return Response.json({
    ok: result.ok,
    metaOk: result.ok,
    error: result.ok ? undefined : result.error,
    ...(statusOk !== undefined ? { statusOk, statusError } : {}),
  })
}

export const config: Config = {
  path: "/api/capi-confirmar-pago",
}
