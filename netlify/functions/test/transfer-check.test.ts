import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeGetStore, resetBlobsMock } from "./helpers/blobsMock"
import { incomingTransfers, matchTransfers, ordersToJudge } from "../lib/transferCheck"
import type { Order } from "../../../src/types/order"

vi.mock("@netlify/blobs", () => ({ getStore: fakeGetStore }))

const sheet = vi.hoisted(() => ({ orders: [] as unknown[] }))
vi.mock("../lib/sheetOrders", () => ({ getSheetOrders: async () => sheet.orders }))

const discord = vi.hoisted(() => ({ sent: [] as string[], keys: new Set<string>() }))
vi.mock("../lib/discordAlert", () => ({
  notifyDiscord: async (key: string, content: string) => {
    if (discord.keys.has(key)) return
    discord.keys.add(key)
    discord.sent.push(content)
  },
}))

import handler from "../transfer-check.mts"

const MIN = 60000
const NOW = Date.now()

function order(key: string, minutesAgo: number, monto = 70000, estado = "pendiente"): Order {
  return {
    timestamp: new Date(NOW - minutesAgo * MIN).toISOString(),
    nombre: `Cliente ${key}`,
    whatsapp: "1123456789",
    discord: "x",
    plan: "diamante",
    monto,
    turno: new Date(NOW + 60 * MIN).toISOString(),
    comprobante: "url",
    estado,
    idempotencykey: key,
  }
}

function payment(id: number, minutesAgo: number, amount = 70000, extra: object = {}) {
  return {
    id,
    status: "approved",
    operation_type: "money_transfer",
    transaction_amount: amount,
    date_approved: new Date(NOW - minutesAgo * MIN).toISOString(),
    payer: { email: "a@b.com" },
    ...extra,
  }
}

function mockMp(results: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ results }), { status: 200 })),
  )
}

const said = (text: string) => discord.sent.filter((m) => m.includes(text))

beforeEach(() => {
  resetBlobsMock()
  discord.sent = []
  discord.keys.clear()
  sheet.orders = []
  process.env.MP_ACCESS_TOKEN = "test"
  mockMp([])
})

describe("incomingTransfers", () => {
  it("toma las que entran y deja afuera las salientes, rechazadas y checkouts", () => {
    const list = incomingTransfers([
      payment(1, 1),
      payment(2, 1, 70000, { operation_type: "account_fund", payer: { identification: { number: "1" } } }),
      payment(3, 1, 70000, { payer: {} }),
      payment(4, 1, 70000, { status: "rejected" }),
      payment(5, 1, 70000, { operation_type: "regular_payment" }),
    ])
    expect(list.map((t) => t.id)).toEqual(["1", "2"])
  })
})

describe("matchTransfers", () => {
  const t = (id: string, minutesAgo: number, amount = 70000) => ({
    id,
    amount,
    time: NOW - minutesAgo * MIN,
  })

  it("un pago sirve para una sola reserva", () => {
    const m = matchTransfers([order("a", 20), order("b", 10)], [t("1", 21)])
    expect(m.has("a")).toBe(true)
    expect(m.has("b")).toBe(false)
  })

  it("exige el monto exacto", () => {
    expect(matchTransfers([order("a", 10)], [t("1", 11, 69999)]).size).toBe(0)
  })

  it("no acepta un pago posterior a la reserva", () => {
    expect(matchTransfers([order("a", 20)], [t("1", 10)]).size).toBe(0)
  })

  it("acepta un pago de varias horas antes", () => {
    expect(matchTransfers([order("a", 10)], [t("1", 180)]).size).toBe(1)
  })
})

describe("ordersToJudge", () => {
  it("espera 5 minutos, ignora las viejas, las atendidas y las ya juzgadas", () => {
    const list = ordersToJudge(
      [
        order("nueva", 2),
        order("lista", 6),
        order("vieja", 200),
        order("atendida", 6, 70000, "atendido"),
        order("juzgada", 6),
      ],
      { juzgada: { result: "ok" } },
      NOW,
    )
    expect(list.map((o) => o.idempotencykey)).toEqual(["lista"])
  })
})

describe("transfer-check", () => {
  it("avisa sospechosa una sola vez si no hay pago, y no toca nada más", async () => {
    sheet.orders = [order("falsa", 6)]
    await handler()
    await handler()
    expect(said("Transferencia sospechosa")).toHaveLength(1)
    const calls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]))
    expect(calls.every((u) => u.includes("api.mercadopago.com"))).toBe(true)
  })

  it("avisa encontrada si está el pago", async () => {
    sheet.orders = [order("real", 6)]
    mockMp([payment(1, 7)])
    await handler()
    expect(said("Transferencia encontrada")).toHaveLength(1)
    expect(said("sospechosa")).toHaveLength(0)
  })

  it("una reserva de Binance no se juzga", async () => {
    sheet.orders = [order("bnb", 6)]
    await fakeGetStore("payment-methods").set("bnb", "binance")
    await handler()
    expect(said("sospechosa")).toHaveLength(0)
  })

  it("si Mercado Pago falla no acusa a nadie y avisa el problema", async () => {
    sheet.orders = [order("x", 6)]
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    )
    await handler()
    expect(said("sospechosa")).toHaveLength(0)
    expect(said("no pudo revisar")).toHaveLength(1)
  })

  it("avisa comprobante repetido solo si la reserva es reciente", async () => {
    const file = new TextEncoder().encode("foto").buffer
    const files = fakeGetStore("comprobantes")
    await files.set("vieja1", file)
    await files.set("vieja2", file)
    await files.set("nueva", file)
    sheet.orders = [order("vieja1", 5000), order("vieja2", 4000), order("nueva", 1)]
    await handler()
    const repeated = said("Comprobante repetido")
    expect(repeated).toHaveLength(1)
    expect(repeated[0]).toContain("Cliente nueva")
  })

  it("un archivo distinto no avisa", async () => {
    const files = fakeGetStore("comprobantes")
    await files.set("a", new TextEncoder().encode("uno").buffer)
    await files.set("b", new TextEncoder().encode("dos").buffer)
    sheet.orders = [order("a", 3), order("b", 1)]
    await handler()
    expect(said("repetido")).toHaveLength(0)
  })
})
