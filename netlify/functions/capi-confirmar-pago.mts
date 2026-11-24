import type { Config, Context } from "@netlify/functions"
import { verifySessionToken } from "./lib/adminSession"
import { sendConfirmedSale } from "./lib/confirmedSale"
import { isRateLimited } from "./lib/rateLimit"
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

  // Compra + Reserva a Meta: misma función que usa el control de transferencias
  // (lib/confirmedSale.ts). Si ya se mandó, Meta no la cuenta dos veces.
  const result = await sendConfirmedSale({
    idempotencyKey: body.idempotencyKey,
    nombre: body.nombre,
    whatsapp: body.whatsapp,
    plan: body.plan,
    monto: body.monto,
    reservaTimestamp: body.reservaTimestamp,
  })

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
