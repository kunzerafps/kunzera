import type { Order } from "../../../src/types/order"

// Lógica pura del control de transferencias (sin red ni Blobs, para poder
// probarla con datos reales). Quien la usa es transfer-check.mts.
//
// Criterio medido el 6/11 sobre 37 transferencias reales: las que entran traen
// mail o DNI de quien paga; las que salen de la cuenta, no. El comprobante se
// sube DESPUÉS de pagar (mediana 42 s, 2 de 36 a más de 2 h).

const MIN = 60 * 1000
const HOUR = 60 * MIN

// Espera antes de opinar sobre una reserva, para que el pago ya figure en MP.
export const WAIT_MS = 5 * MIN
// Reservas más viejas que esto no se juzgan: ya las vio una persona.
export const MAX_JUDGE_AGE_MS = 3 * HOUR
// Cuánto antes de la reserva puede haber entrado el pago.
export const LOOKBACK_MS = 24 * HOUR
// Diferencia de reloj tolerada: nadie sube el comprobante antes de pagar.
export const CLOCK_SLACK_MS = 2 * MIN
// Reservas que se reparten los pagos: tienen que ser todas las recientes, para
// que una reserva nueva no se quede con el pago de una anterior.
export const MATCH_WINDOW_MS = 48 * HOUR

export type Transfer = { id: string; amount: number; time: number }

type MpPayment = {
  id?: unknown
  status?: unknown
  operation_type?: unknown
  transaction_amount?: unknown
  date_approved?: unknown
  date_created?: unknown
  payer?: { email?: unknown; identification?: { number?: unknown } | null } | null
}

export function incomingTransfers(payments: unknown[]): Transfer[] {
  const out: Transfer[] = []
  for (const raw of payments) {
    const p = (raw ?? {}) as MpPayment
    if (p.status !== "approved") continue
    if (p.operation_type !== "money_transfer" && p.operation_type !== "account_fund") continue
    if (!p.payer?.email && !p.payer?.identification?.number) continue
    const amount = Number(p.transaction_amount)
    const time = new Date(String(p.date_approved || p.date_created)).getTime()
    if (!Number.isFinite(amount) || !Number.isFinite(time)) continue
    out.push({ id: String(p.id), amount, time })
  }
  return out
}

export function orderTime(o: Order): number {
  return new Date(o.timestamp).getTime()
}

// Cada pago sirve para una sola reserva. Se recorre de la más vieja a la más
// nueva y cada una toma el pago de su monto más cercano antes de reservar: si
// hay más reservas que pagos, la que sobra queda sin pago.
export function matchTransfers(orders: Order[], transfers: Transfer[]): Map<string, Transfer> {
  const used = new Set<string>()
  const matched = new Map<string, Transfer>()
  const sorted = [...orders].sort((a, b) => orderTime(a) - orderTime(b))
  for (const o of sorted) {
    const t = orderTime(o)
    const best = transfers
      .filter(
        (p) =>
          !used.has(p.id) &&
          p.amount === Number(o.monto) &&
          p.time <= t + CLOCK_SLACK_MS &&
          p.time >= t - LOOKBACK_MS,
      )
      .sort((a, b) => b.time - a.time)[0]
    if (best && o.idempotencykey) {
      used.add(best.id)
      matched.set(o.idempotencykey, best)
    }
  }
  return matched
}

export function ordersToJudge(
  orders: Order[],
  verdicts: Record<string, unknown>,
  now: number,
): Order[] {
  return orders.filter((o) => {
    const age = now - orderTime(o)
    return (
      !!o.idempotencykey &&
      o.estado === "pendiente" &&
      age >= WAIT_MS &&
      age <= MAX_JUDGE_AGE_MS &&
      !verdicts[o.idempotencykey]
    )
  })
}
