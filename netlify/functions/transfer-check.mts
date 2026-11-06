import type { Config } from "@netlify/functions"
import { getStore } from "@netlify/blobs"
import { createHash } from "node:crypto"
import { getSheetOrders } from "./lib/sheetOrders"
import { notifyDiscord } from "./lib/discordAlert"
import { todayInArgentina } from "./lib/argentinaTime"
import {
  incomingTransfers,
  matchTransfers,
  orderTime,
  ordersToJudge,
  MATCH_WINDOW_MS,
  type Transfer,
} from "./lib/transferCheck"
import type { Order } from "../../src/types/order"

// Control de transferencias: SOLO AVISA por Discord. No cambia ninguna reserva
// ni le manda nada a Meta. Cada 2 minutos:
//  1. Reserva por transferencia sin un pago de ese monto en Mercado Pago:
//     "Transferencia sospechosa". Una foto cualquiera cae acá.
//  2. Comprobante idéntico (mismo archivo) al de otra reserva: "repetido".
//     No lee la imagen: una captura nueva del mismo comprobante no coincide,
//     pero esa la agarra el punto 1 porque el pago ya se usó.

const STATE_STORE = "transfer-check"
const STATE_KEY = "state"
const PRINTS_KEY = "huellas"
const COMPROBANTES_STORE = "comprobantes"
const METHOD_STORE = "payment-methods"

const MP_PAGES = 3
const MP_PAGE_SIZE = 100
const MAX_FILES_PER_RUN = 25
const FILES_AT_ONCE = 5
const FILES_BUDGET_MS = 15000
const RECENT_ORDER_MS = 15 * 60 * 1000
const ALERT_REPEAT_MAX_AGE_MS = 24 * 60 * 60 * 1000
const VERDICT_KEEP_MS = 7 * 24 * 60 * 60 * 1000

// Prueba del 6/11: también avisa las que dieron bien, para ver el sistema
// andando. En false solo quedan los avisos de problemas.
const NOTIFY_OK = true

type State = {
  verdicts: Record<string, { result: "ok" | "sospechosa"; at: number }>
  repeats?: Record<string, number>
  backfillDone?: boolean
}

function money(n: number): string {
  return `$${Number(n).toLocaleString("es-AR")}`
}

function argTime(ms: number): string {
  const d = new Date(ms - 3 * 60 * 60 * 1000).toISOString()
  return `${d.slice(8, 10)}/${d.slice(5, 7)} ${d.slice(11, 16)}`
}

function describe(o: Order): string {
  return `**${o.nombre}** · ${o.plan} ${money(o.monto)} · reservó ${argTime(orderTime(o))} · turno ${argTime(new Date(o.turno).getTime())}`
}

async function fetchTransfers(): Promise<Transfer[]> {
  const token = process.env.MP_ACCESS_TOKEN
  if (!token) throw new Error("falta MP_ACCESS_TOKEN")
  const payments: unknown[] = []
  for (let page = 0; page < MP_PAGES; page++) {
    const url =
      "https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc" +
      `&range=date_created&begin_date=NOW-3DAYS&end_date=NOW&limit=${MP_PAGE_SIZE}&offset=${page * MP_PAGE_SIZE}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) throw new Error(`Mercado Pago respondió ${res.status}`)
    const data = (await res.json()) as { results?: unknown[] }
    const results = data.results ?? []
    payments.push(...results)
    if (results.length < MP_PAGE_SIZE) break
  }
  return incomingTransfers(payments)
}

// Binance y Mercado Pago no entran a la cuenta como transferencia.
async function onlyTransferOrders(orders: Order[]): Promise<Order[]> {
  const store = getStore(METHOD_STORE)
  const methods = await Promise.all(orders.map((o) => store.get(o.idempotencykey || "x")))
  return orders.filter((_, i) => methods[i] !== "binance" && methods[i] !== "mercadopago")
}

async function checkTransfers(orders: Order[], state: State, now: number): Promise<void> {
  const candidates = ordersToJudge(orders, state.verdicts, now)
  if (candidates.length === 0) return

  const transfers = await fetchTransfers()
  await notifyDiscord(
    "transfer-check-encendido",
    `🟢 Control de transferencias encendido. Leí ${transfers.length} transferencias de los últimos 3 días.`,
  )

  const recent = await onlyTransferOrders(
    orders.filter((o) => now - orderTime(o) <= MATCH_WINDOW_MS),
  )
  const matched = matchTransfers(recent, transfers)
  const transferKeys = new Set(recent.map((o) => o.idempotencykey))

  for (const o of candidates) {
    const key = o.idempotencykey as string
    if (!transferKeys.has(key)) continue
    const payment = matched.get(key)
    if (payment) {
      state.verdicts[key] = { result: "ok", at: now }
      if (NOTIFY_OK) {
        await notifyDiscord(
          `transfer-ok-${key}`,
          `✅ Transferencia encontrada: ${describe(o)} · pago de ${argTime(payment.time)}`,
        )
      }
    } else {
      state.verdicts[key] = { result: "sospechosa", at: now }
      await notifyDiscord(
        `transfer-sospechosa-${key}`,
        `⚠️ **Transferencia sospechosa**: ${describe(o)}\nNo hay en Mercado Pago un pago libre de ese monto. Revisá el comprobante antes de atender.`,
      )
    }
  }
}

async function checkRepeatedFiles(orders: Order[], state: State, now: number): Promise<void> {
  const newOrder = orders.some((o) => now - orderTime(o) <= RECENT_ORDER_MS)
  if (state.backfillDone && !newOrder) return

  const started = Date.now()
  const files = getStore(COMPROBANTES_STORE)
  const stateStore = getStore(STATE_STORE)
  const { blobs } = await files.list()
  const prints = ((await stateStore.get(PRINTS_KEY, { type: "json", consistency: "strong" })) ??
    {}) as Record<string, string>

  const byKey = new Map(orders.map((o) => [o.idempotencykey, o]))
  const pending = blobs
    .map((b) => b.key)
    .filter((k) => !prints[k])
    .sort((a, b) => {
      const oa = byKey.get(a)
      const ob = byKey.get(b)
      return (ob ? orderTime(ob) : 0) - (oa ? orderTime(oa) : 0)
    })
  const batch = pending.slice(0, MAX_FILES_PER_RUN)

  const owners = new Map(Object.entries(prints).map(([k, h]) => [h, k]))
  for (let i = 0; i < batch.length; i += FILES_AT_ONCE) {
    if (Date.now() - started > FILES_BUDGET_MS) break
    const group = batch.slice(i, i + FILES_AT_ONCE)
    const contents = await Promise.all(group.map((k) => files.get(k, { type: "arrayBuffer" })))
    for (let j = 0; j < group.length; j++) {
      const key = group[j]
      const data = contents[j]
      if (!data) continue
      const hash = createHash("sha256").update(Buffer.from(data)).digest("hex")
      prints[key] = hash
      const firstKey = owners.get(hash)
      if (!firstKey) {
        owners.set(hash, key)
        continue
      }
      // Mientras se cargan los históricos se recorre de nuevo a viejo: la reserva
      // a avisar es siempre la más nueva del par, no la última que se leyó.
      const pair = [byKey.get(key), byKey.get(firstKey)].filter((o): o is Order => !!o)
      pair.sort((x, y) => orderTime(y) - orderTime(x))
      const [newer, older] = pair
      if (!newer || now - orderTime(newer) > ALERT_REPEAT_MAX_AGE_MS) continue
      state.repeats = { ...state.repeats, [String(newer.idempotencykey)]: now }
      await notifyDiscord(
        `comprobante-repetido-${newer.idempotencykey}`,
        `🔁 **Comprobante repetido**: ${describe(newer)}\nEs el mismo archivo que ${older ? describe(older) : "el de una reserva vieja que ya no está en la planilla"}.`,
      )
    }
  }

  await stateStore.setJSON(PRINTS_KEY, prints)
  state.backfillDone = pending.length <= MAX_FILES_PER_RUN
}

export default async (): Promise<Response> => {
  const now = Date.now()
  const day = todayInArgentina()
  const store = getStore(STATE_STORE)
  try {
    const saved = (await store.get(STATE_KEY, {
      type: "json",
      consistency: "strong",
    })) as State | null
    const state: State = saved ?? { verdicts: {} }
    const orders = await getSheetOrders({ attempts: 2, timeoutMs: 8000 })

    try {
      await checkTransfers(orders, state, now)
    } catch (err) {
      console.error("[transfer-check] transferencias:", err)
      await notifyDiscord(
        `transfer-check-error-${day}`,
        `❗ El control de transferencias no pudo revisar: ${String(err).slice(0, 150)}`,
      )
    }
    try {
      await checkRepeatedFiles(orders, state, now)
    } catch (err) {
      console.error("[transfer-check] comprobantes:", err)
      await notifyDiscord(
        `comprobantes-check-error-${day}`,
        `❗ El control de comprobantes repetidos no pudo revisar: ${String(err).slice(0, 150)}`,
      )
    }

    for (const [key, v] of Object.entries(state.verdicts)) {
      if (now - v.at > VERDICT_KEEP_MS) delete state.verdicts[key]
    }
    for (const [key, at] of Object.entries(state.repeats ?? {})) {
      if (now - at > VERDICT_KEEP_MS) delete state.repeats?.[key]
    }
    await store.setJSON(STATE_KEY, state)
  } catch (err) {
    console.error("[transfer-check] error general:", err)
    await notifyDiscord(
      `transfer-check-caido-${day}`,
      `❗ El control de transferencias no pudo correr: ${String(err).slice(0, 150)}`,
    )
  }
  return new Response(null, { status: 200 })
}

export const config: Config = {
  schedule: "*/2 * * * *",
}
