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

function manualDeliveryEntry(overrides: Partial<Record<string, unknown>>) {
  return {
    eventId: "manual-1",
    source: "venta_manual",
    attempts: 1,
    lastAttemptAt: new Date(`${YESTERDAY}T20:00:00.000Z`).getTime(),
    ok: true,
    dedupedLocally: false,
    ...overrides,
  }
}

function mockAppsScript(fm: ReturnType<typeof installFetchMock>, orders: unknown[]) {
  fm.on("script.google.com", () => jsonResponse({ ok: true, orders }))
}

function mockMetaInsights(fm: ReturnType<typeof installFetchMock>, actions: { action_type: string; value: string }[] | null) {
  fm.on("graph.facebook.com", () =>
    jsonResponse({ data: actions === null ? [] : [{ spend: "1000", actions }] }),
  )
}

function mockMetaInsightsCount(fm: ReturnType<typeof installFetchMock>, purchaseCount: number | null) {
  mockMetaInsights(fm, purchaseCount === null ? null : [{ action_type: "purchase", value: String(purchaseCount) }])
}

function mockDiscord(fm: ReturnType<typeof installFetchMock>) {
  fm.on("discord.com/api/webhooks/test", () => new Response(null, { status: 204 }))
}

describe("daily-gap-report (compara ventas reales vs. Purchase que Meta contó)", () => {
  beforeEach(() => {
    resetBlobsMock()
    // shouldAdvanceTime: true — el reintento de fetchOrders espera con
    // setTimeout real entre intentos; sin esto, esas esperas nunca se
    // resuelven bajo fake timers y los tests de reintento cuelgan.
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
    mockMetaInsightsCount(fm, 4)
    mockDiscord(fm)

    await fakeGetStore("capi-delivery-log").set(
      "manual-1",
      manualDeliveryEntry({ saleDate: YESTERDAY }),
    )

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

  it("hay diferencia (4 reales vs 3 en Meta): avisa por Discord una sola vez, sin pedirle una acción técnica a Eze", async () => {
    const fm = installFetchMock()
    mockAppsScript(fm, [
      order({ idempotencykey: "a" }),
      order({ idempotencykey: "b" }),
      order({ idempotencykey: "c" }),
      order({ idempotencykey: "d" }),
    ])
    mockMetaInsightsCount(fm, 3)
    mockDiscord(fm)

    const res = await gapReportHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.matched).toBe(false)
    expect(fm.callsTo("discord.com")).toHaveLength(1)
    const alertBody = JSON.parse(String(fm.callsTo("discord.com")[0].init?.body))
    expect(alertBody.content).toContain("4 ventas reales")
    expect(alertBody.content).toContain("3 que Meta contó")
    expect(alertBody.content).toContain("No hace falta que hagas nada")
    expect(alertBody.content).not.toContain("Events Manager")
  })

  it("ignora reservas 'pendiente' y reservas de otro día", async () => {
    const fm = installFetchMock()
    mockAppsScript(fm, [
      order({ idempotencykey: "a", estado: "confirmado" }),
      order({ idempotencykey: "b", estado: "pendiente" }),
      order({ idempotencykey: "c", estado: "confirmado", timestamp: "2026-08-04T18:00:00.000Z" }),
    ])
    mockMetaInsightsCount(fm, 1)
    mockDiscord(fm)

    const res = await gapReportHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.sheetCount).toBe(1)
    expect(data.matched).toBe(true)
  })

  it("una reserva a las 23:30 hora Argentina (02:30 UTC del día siguiente) cuenta para el día correcto en Argentina, no el de UTC", async () => {
    const fm = installFetchMock()
    // 2026-08-06T02:30:00.000Z es 2026-08-05 23:30 en Argentina → debe
    // contar como YESTERDAY (2026-08-05), no como 2026-08-06.
    mockAppsScript(fm, [order({ idempotencykey: "a", timestamp: "2026-08-06T02:30:00.000Z" })])
    mockMetaInsightsCount(fm, 1)
    mockDiscord(fm)

    const res = await gapReportHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.sheetCount).toBe(1)
  })

  it("una reserva a las 03:00:00.000Z (00:00 en Argentina) ya cuenta para el día siguiente, no para YESTERDAY", async () => {
    const fm = installFetchMock()
    mockAppsScript(fm, [order({ idempotencykey: "a", timestamp: "2026-08-06T03:00:00.000Z" })])
    mockMetaInsightsCount(fm, 0)
    mockDiscord(fm)

    const res = await gapReportHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.sheetCount).toBe(0)
  })

  it("ignora ventas manuales dedupedLocally, no-ok, o de otra fuente", async () => {
    const fm = installFetchMock()
    mockAppsScript(fm, [order({ idempotencykey: "z" })]) // 1 venta del Sheet, para que orders.length no sea 0
    mockMetaInsightsCount(fm, 1)
    mockDiscord(fm)

    await fakeGetStore("capi-delivery-log").set(
      "dup",
      manualDeliveryEntry({ eventId: "dup", dedupedLocally: true }),
    )
    await fakeGetStore("capi-delivery-log").set(
      "mp",
      manualDeliveryEntry({ eventId: "mp", source: "mercadopago" }),
    )
    await fakeGetStore("capi-delivery-log").set(
      "failed",
      manualDeliveryEntry({ eventId: "failed", ok: false }),
    )

    const res = await gapReportHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.manualCount).toBe(0)
  })

  it("usa saleDate (fecha real de la venta) en vez de lastAttemptAt cuando está disponible", async () => {
    const fm = installFetchMock()
    mockAppsScript(fm, [order({ idempotencykey: "z" })])
    mockMetaInsightsCount(fm, 2)
    mockDiscord(fm)

    // Cargada en el panel HOY (lastAttemptAt = hoy) pero la venta real fue
    // AYER (saleDate) — debe contar para ayer, no para hoy, ni quedar
    // afuera de ambos días.
    await fakeGetStore("capi-delivery-log").set(
      "manual-backdated",
      manualDeliveryEntry({
        eventId: "manual-backdated",
        saleDate: YESTERDAY,
        lastAttemptAt: NOW.getTime(),
      }),
    )

    const res = await gapReportHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.manualCount).toBe(1)
    expect(data.matched).toBe(true) // 1 (sheet) + 1 (manual, por saleDate) = 2 = metaCount
  })

  it("entradas viejas sin saleDate caen a lastAttemptAt como aproximación (compatibilidad hacia atrás)", async () => {
    const fm = installFetchMock()
    mockAppsScript(fm, [order({ idempotencykey: "z" })])
    mockMetaInsightsCount(fm, 2)
    mockDiscord(fm)

    await fakeGetStore("capi-delivery-log").set(
      "manual-old",
      manualDeliveryEntry({ eventId: "manual-old", saleDate: undefined }), // sin saleDate
    )

    const res = await gapReportHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.manualCount).toBe(1) // lastAttemptAt del helper ya es de YESTERDAY
  })

  it("con múltiples action_types para la misma compra, cuenta el máximo (no suma todos los alias)", async () => {
    const fm = installFetchMock()
    mockAppsScript(fm, [order({ idempotencykey: "a" })])
    mockMetaInsights(fm, [
      { action_type: "web_in_store_purchase", value: "4" },
      { action_type: "omni_purchase", value: "4" },
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "4" },
      { action_type: "purchase", value: "1" }, // valor distinto a propósito
      { action_type: "onsite_web_app_purchase", value: "4" },
      { action_type: "link_click", value: "999" }, // no es de compra, debe ignorarse
    ])
    mockDiscord(fm)

    const res = await gapReportHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.metaCount).toBe(4) // el máximo entre los alias de compra, no 1 (solo "purchase") ni 999 ni la suma
  })

  it("si Meta no incluye el alias exacto 'purchase' ese día, igual cuenta por otro alias de compra", async () => {
    const fm = installFetchMock()
    mockAppsScript(fm, [order({ idempotencykey: "a" })])
    mockMetaInsights(fm, [{ action_type: "omni_purchase", value: "1" }]) // sin "purchase" exacto
    mockDiscord(fm)

    const res = await gapReportHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.metaCount).toBe(1)
    expect(data.matched).toBe(true)
  })

  it("si Meta no tiene datos ese día (sin data[]), cuenta 0 en vez de romper", async () => {
    const fm = installFetchMock()
    mockAppsScript(fm, [order({ idempotencykey: "a", estado: "pendiente" })]) // 0 ventas reales, 1 registro total (no dispara el chequeo de "0 en total")
    mockMetaInsightsCount(fm, null)
    mockDiscord(fm)

    const res = await gapReportHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.ok).toBe(true)
    expect(data.metaCount).toBe(0)
  })

  it("si el Sheet devuelve 0 reservas en TOTAL (no solo ayer), lo trata como error, no como 'día sin ventas'", async () => {
    const fm = installFetchMock()
    mockAppsScript(fm, []) // orders: [] — todo el historial vacío, sospechoso
    mockMetaInsightsCount(fm, 2)
    mockDiscord(fm)

    const res = await gapReportHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(res.status).toBe(500)
    expect(data.ok).toBe(false)
    expect(fm.callsTo("discord.com")).toHaveLength(1)
    const alertBody = JSON.parse(String(fm.callsTo("discord.com")[0].init?.body))
    expect(alertBody.content).not.toContain("META_MARKETING_ACCESS_TOKEN") // no filtra secretos/detalle crudo
  })

  it("si falla la lectura del Sheet tras agotar los 3 reintentos, avisa el error por Discord y no rompe silenciosamente", async () => {
    const fm = installFetchMock()
    fm.on("script.google.com", () => jsonResponse({ ok: false, error: "network" }))
    mockMetaInsightsCount(fm, 4)
    mockDiscord(fm)

    const res = await gapReportHandler(new Request("https://kunzera.com"), FAKE_CTX)

    expect(res.status).toBe(500)
    expect(fm.callsTo("script.google.com")).toHaveLength(3) // los 3 reintentos configurados, ni más ni menos
    expect(fm.callsTo("discord.com")).toHaveLength(1)
    const alertBody = JSON.parse(String(fm.callsTo("discord.com")[0].init?.body))
    expect(alertBody.content).toContain("No hace falta que hagas nada")
  }, 15000)

  it("si el Sheet falla los primeros 2 intentos pero responde bien al 3ro, se recupera solo (reintento real, no solo teórico)", async () => {
    const fm = installFetchMock()
    let calls = 0
    fm.on("script.google.com", () => {
      calls++
      if (calls < 3) return jsonResponse({ ok: false, error: "network" })
      return jsonResponse({ ok: true, orders: [order({ idempotencykey: "a" })] })
    })
    mockMetaInsightsCount(fm, 1)
    mockDiscord(fm)

    const res = await gapReportHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.ok).toBe(true)
    expect(data.sheetCount).toBe(1)
    expect(data.matched).toBe(true)
    expect(fm.callsTo("discord.com")).toHaveLength(0)
  }, 15000)
})
