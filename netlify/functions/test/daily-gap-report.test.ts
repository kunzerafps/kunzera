import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeGetStore, resetBlobsMock } from "./helpers/blobsMock"
import { installFetchMock, jsonResponse } from "./helpers/fetchMock"

vi.mock("@netlify/blobs", () => ({ getStore: (name: string) => fakeGetStore(name) }))

const { default: gapReportHandler } = await import("../daily-gap-report.mts")

const FAKE_CTX = {} as any

// 15:00 UTC del 6 de agosto = 12:00 en Argentina (UTC-3) → "ayer" da 2026-08-05
// sin ambigüedad de huso horario.
const NOW = new Date("2026-08-06T15:00:00Z")
const YESTERDAY = "2026-08-05"

function order(overrides: Partial<Record<string, unknown>>) {
  return {
    timestamp: `${YESTERDAY}T18:00:00.000Z`,
    nombre: "Cliente",
    whatsapp: "5493382677871",
    discord: "",
    plan: "platino",
    monto: 50000,
    turno: "",
    comprobante: "",
    estado: "confirmado",
    idempotencykey: "key-1",
    ...overrides,
  }
}

function mockAppsScript(fm: ReturnType<typeof installFetchMock>, orders: unknown[]) {
  fm.on("script.google.com", () => jsonResponse({ ok: true, orders }))
}

function mockMetaInsights(fm: ReturnType<typeof installFetchMock>, purchaseCount: number | null) {
  fm.on("graph.facebook.com", () =>
    jsonResponse({
      data:
        purchaseCount === null
          ? []
          : [{ spend: "1000", actions: [{ action_type: "purchase", value: String(purchaseCount) }] }],
    }),
  )
}

function mockDiscord(fm: ReturnType<typeof installFetchMock>) {
  fm.on("discord.com/api/webhooks/test", () => new Response(null, { status: 204 }))
}

describe("daily-gap-report (compara ventas reales vs. Purchase que Meta contó)", () => {
  beforeEach(() => {
    resetBlobsMock()
    // shouldAdvanceTime: true — el reintento de fetchOrders espera con
    // setTimeout real entre intentos; sin esto, esas esperas nunca se
    // resuelven bajo fake timers y el test de "falla la lectura" cuelga.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(NOW)
    process.env.META_MARKETING_ACCESS_TOKEN = "test-marketing-token"
    process.env.MP_DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/test"
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("todo coincide (3 del Sheet + 1 manual = 4, Meta cuenta 4): no manda nada a Discord", async () => {
    const fm = installFetchMock()
    mockAppsScript(fm, [
      order({ idempotencykey: "a", estado: "confirmado" }),
      order({ idempotencykey: "b", estado: "atendido" }),
      order({ idempotencykey: "c", estado: "confirmado" }),
    ])
    mockMetaInsights(fm, 4)
    mockDiscord(fm)

    await fakeGetStore("capi-delivery-log").set("manual-1", {
      eventId: "manual-1",
      source: "venta_manual",
      attempts: 1,
      lastAttemptAt: new Date(`${YESTERDAY}T20:00:00.000Z`).getTime(),
      ok: true,
      dedupedLocally: false,
    })

    const res = await gapReportHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.ok).toBe(true)
    expect(data.sheetCount).toBe(3)
    expect(data.manualCount).toBe(1)
    expect(data.realSales).toBe(4)
    expect(data.metaCount).toBe(4)
    expect(data.matched).toBe(true)
    expect(fm.callsTo("discord.com")).toHaveLength(0)
  })

  it("hay diferencia (4 reales vs 3 en Meta): avisa por Discord una sola vez", async () => {
    const fm = installFetchMock()
    mockAppsScript(fm, [
      order({ idempotencykey: "a" }),
      order({ idempotencykey: "b" }),
      order({ idempotencykey: "c" }),
      order({ idempotencykey: "d" }),
    ])
    mockMetaInsights(fm, 3)
    mockDiscord(fm)

    const res = await gapReportHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.matched).toBe(false)
    expect(fm.callsTo("discord.com")).toHaveLength(1)
    const alertBody = JSON.parse(String(fm.callsTo("discord.com")[0].init?.body))
    expect(alertBody.content).toContain("4 ventas reales")
    expect(alertBody.content).toContain("3")
  })

  it("ignora reservas 'pendiente' y reservas de otro día", async () => {
    const fm = installFetchMock()
    mockAppsScript(fm, [
      order({ idempotencykey: "a", estado: "confirmado" }),
      order({ idempotencykey: "b", estado: "pendiente" }),
      order({ idempotencykey: "c", estado: "confirmado", timestamp: "2026-08-04T18:00:00.000Z" }),
    ])
    mockMetaInsights(fm, 1)
    mockDiscord(fm)

    const res = await gapReportHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.sheetCount).toBe(1)
    expect(data.matched).toBe(true)
  })

  it("ignora ventas manuales dedupedLocally o de otra fuente", async () => {
    const fm = installFetchMock()
    mockAppsScript(fm, [])
    mockMetaInsights(fm, 0)
    mockDiscord(fm)

    await fakeGetStore("capi-delivery-log").set("dup", {
      eventId: "dup",
      source: "venta_manual",
      attempts: 2,
      lastAttemptAt: new Date(`${YESTERDAY}T20:00:00.000Z`).getTime(),
      ok: true,
      dedupedLocally: true,
    })
    await fakeGetStore("capi-delivery-log").set("mp", {
      eventId: "mp",
      source: "mercadopago",
      attempts: 1,
      lastAttemptAt: new Date(`${YESTERDAY}T20:00:00.000Z`).getTime(),
      ok: true,
      dedupedLocally: false,
    })

    const res = await gapReportHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.manualCount).toBe(0)
  })

  it("si Meta no tiene datos ese día (sin data[]), cuenta 0 en vez de romper", async () => {
    const fm = installFetchMock()
    mockAppsScript(fm, [])
    mockMetaInsights(fm, null)
    mockDiscord(fm)

    const res = await gapReportHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.ok).toBe(true)
    expect(data.metaCount).toBe(0)
  })

  it("si falla la lectura del Sheet, avisa el error por Discord y no rompe silenciosamente", async () => {
    const fm = installFetchMock()
    fm.on("script.google.com", () => jsonResponse({ ok: false, error: "network" }))
    mockMetaInsights(fm, 4)
    mockDiscord(fm)

    const res = await gapReportHandler(new Request("https://kunzera.com"), FAKE_CTX)
    expect(res.status).toBe(500)
    expect(fm.callsTo("discord.com")).toHaveLength(1)
    const alertBody = JSON.parse(String(fm.callsTo("discord.com")[0].init?.body))
    expect(alertBody.content).toContain("no se pudo completar")
  })
})
