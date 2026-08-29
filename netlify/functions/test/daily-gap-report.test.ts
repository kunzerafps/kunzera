import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeGetStore, resetBlobsMock } from "./helpers/blobsMock"
import { installFetchMock, jsonResponse } from "./helpers/fetchMock"

vi.mock("@netlify/blobs", () => ({ getStore: (name: string) => fakeGetStore(name) }))

const { default: reconcileHandler } = await import("../daily-gap-report.mts")
const { listManualSales } = await import("../lib/manualSalesStore")

const FAKE_CTX = {} as any

// 15:00 UTC del 6 ago = 12:00 Argentina. Ventana del robot: de hace 9 a hace 2
// días → [2026-07-28 .. 2026-08-04]. "Ayer" (08-05) y "hoy" (08-06) NO se
// tocan (demasiado frescos).
const NOW = new Date("2026-08-06T15:00:00Z")
const IN_WINDOW = "2026-08-03" // dentro de la ventana
const TOO_FRESH = "2026-08-05" // ayer — no se toca
const TOO_OLD = "2026-07-20" // fuera de la ventana por atrás

function order(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    timestamp: `${IN_WINDOW}T18:00:00.000Z`,
    nombre: "Cliente",
    whatsapp: "5493382677871",
    discord: "",
    plan: "platino",
    monto: 50000,
    turno: "",
    comprobante: "",
    estado: "atendido",
    idempotencykey: "key-1",
    ...overrides,
  }
}

function deliveryEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    eventId: "key-1",
    source: "transferencia_binance",
    attempts: 1,
    lastAttemptAt: new Date(`${IN_WINDOW}T20:00:00.000Z`).getTime(),
    ok: true,
    dedupedLocally: false,
    ...overrides,
  }
}

function manualSale(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "KZM-260803-ABCD",
    createdAt: NOW.getTime(),
    saleDate: IN_WINDOW,
    nombre: "Wsp Cliente",
    whatsapp: "1122334455",
    email: "cli@mail.com",
    monto: 70000,
    pack: "diamante",
    metaEventId: "manual-evt-1",
    metaStatus: "error",
    ...overrides,
  }
}

function mockSheet(fm: ReturnType<typeof installFetchMock>, orders: unknown[]) {
  fm.on("script.google.com", () => jsonResponse({ ok: true, orders }))
}
function mockMeta(fm: ReturnType<typeof installFetchMock>, status = 200) {
  fm.on("graph.facebook.com", () => jsonResponse(status === 200 ? {} : { error: { message: "bad" } }, status))
}
function mockDiscord(fm: ReturnType<typeof installFetchMock>) {
  fm.on("discord.com/api/webhooks/test", () => new Response(null, { status: 204 }))
}
function discordBodies(fm: ReturnType<typeof installFetchMock>): string[] {
  return fm.callsTo("discord.com").map((c) => JSON.parse(String(c.init?.body)).content)
}

describe("daily-gap-report — reconcilia y REENVÍA las ventas que no llegaron a Meta", () => {
  beforeEach(() => {
    resetBlobsMock()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(NOW)
    process.env.META_CAPI_ACCESS_TOKEN = "test-token"
    process.env.MP_DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/test"
  })
  afterEach(() => vi.useRealTimers())

  it("todo ya llegó a Meta: no reenvía nada y no toca Discord", async () => {
    const fm = installFetchMock()
    mockSheet(fm, [order({ idempotencykey: "key-1" })])
    mockMeta(fm)
    mockDiscord(fm)
    await fakeGetStore("capi-delivery-log").set("key-1", deliveryEntry({ eventId: "key-1" }))

    const res = await reconcileHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.resent).toBe(0)
    expect(fm.callsTo("graph.facebook.com")).toHaveLength(0) // no reenvió
    expect(fm.callsTo("discord.com")).toHaveLength(0) // silencio
  })

  it("una venta del sitio que NO llegó a Meta: la reenvía", async () => {
    const fm = installFetchMock()
    mockSheet(fm, [order({ idempotencykey: "faltante-1", nombre: "Juan" })])
    mockMeta(fm) // 200 → envío OK
    mockDiscord(fm)
    // delivery-log vacío para esa key → falta

    const res = await reconcileHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.resent).toBe(1)
    expect(data.failed).toBe(0)
    const sent = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    expect(sent.data[0].event_name).toBe("Purchase")
    expect(sent.data[0].event_id).toBe("faltante-1")
    expect(sent.data[0].custom_data.value).toBe(50000)
    // aviso corto de "ya lo arreglé"
    expect(discordBodies(fm).join("")).toContain("Reenvié 1")
    expect(discordBodies(fm).join("")).toContain("Juan")
  })

  it("una venta manual con metaStatus 'error': la reenvía y marca el registro como ok", async () => {
    const fm = installFetchMock()
    mockSheet(fm, [order()]) // una del sitio ya OK, para que el Sheet no dé 0
    mockMeta(fm)
    mockDiscord(fm)
    await fakeGetStore("capi-delivery-log").set("key-1", deliveryEntry())
    await fakeGetStore("ventas-manuales").set("manual-evt-1", manualSale())

    const res = await reconcileHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.resent).toBe(1)
    const sent = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    expect(sent.data[0].event_id).toBe("manual-evt-1")
    expect(sent.data[0].action_source).toBe("business_messaging")
    // el panel ahora ve la venta como enviada
    const [refreshed] = await listManualSales()
    expect(refreshed.metaStatus).toBe("ok")
  })

  it("si el reenvío a Meta FALLA, avisa por Discord cuál venta no pudo mandar", async () => {
    const fm = installFetchMock()
    mockSheet(fm, [order({ idempotencykey: "rota-1", nombre: "Pedro" })])
    mockMeta(fm, 400) // Meta rechaza
    mockDiscord(fm)

    const res = await reconcileHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.resent).toBe(0)
    expect(data.failed).toBe(1)
    expect(data.ok).toBe(false)
    const body = discordBodies(fm).join("")
    expect(body).toContain("No se pudieron reenviar")
    expect(body).toContain("Pedro")
  })

  it("una venta con monto 0/ inválido no se reenvía y se avisa para revisar la planilla", async () => {
    const fm = installFetchMock()
    mockSheet(fm, [order({ idempotencykey: "cero-1", nombre: "Ana", monto: 0 })])
    mockMeta(fm)
    mockDiscord(fm)

    const res = await reconcileHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(fm.callsTo("graph.facebook.com")).toHaveLength(0)
    expect(data.skipped).toBe(1)
    expect(discordBodies(fm).join("")).toContain("monto inválido")
  })

  it("NO toca ventas de ayer (demasiado frescas) ni de hace más de 9 días", async () => {
    const fm = installFetchMock()
    mockSheet(fm, [
      order({ idempotencykey: "fresca", timestamp: `${TOO_FRESH}T18:00:00.000Z` }),
      order({ idempotencykey: "vieja", timestamp: `${TOO_OLD}T18:00:00.000Z` }),
      order({ idempotencykey: "ok-1" }), // esta sí está en ventana pero ya llegó
    ])
    mockMeta(fm)
    mockDiscord(fm)
    await fakeGetStore("capi-delivery-log").set("ok-1", deliveryEntry({ eventId: "ok-1" }))

    const res = await reconcileHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.resent).toBe(0)
    expect(fm.callsTo("graph.facebook.com")).toHaveLength(0)
  })

  it("una venta con entrega marcada dedupedLocally (Meta ya la tenía) tampoco se reenvía", async () => {
    const fm = installFetchMock()
    mockSheet(fm, [order({ idempotencykey: "dedup-1" })])
    mockMeta(fm)
    mockDiscord(fm)
    await fakeGetStore("capi-delivery-log").set(
      "dedup-1",
      deliveryEntry({ eventId: "dedup-1", ok: false, dedupedLocally: true }),
    )

    const res = await reconcileHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.resent).toBe(0)
    expect(fm.callsTo("graph.facebook.com")).toHaveLength(0)
  })

  it("si faltan MUCHAS de golpe (>10), NO reenvía en masa: avisa que revisen", async () => {
    const fm = installFetchMock()
    const many = Array.from({ length: 12 }, (_, i) =>
      order({ idempotencykey: `m-${i}` }),
    )
    mockSheet(fm, many)
    mockMeta(fm)
    mockDiscord(fm)

    const res = await reconcileHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.tooMany).toBe(12)
    expect(fm.callsTo("graph.facebook.com")).toHaveLength(0) // no bombardea a Meta
    expect(discordBodies(fm).join("")).toContain("demasiado")
  })

  it("si no se puede leer el Sheet, igual reconcilia las ventas manuales y avisa lo del Sheet", async () => {
    const fm = installFetchMock()
    fm.on("script.google.com", () => jsonResponse({ ok: false, error: "network" }))
    mockMeta(fm)
    mockDiscord(fm)
    await fakeGetStore("ventas-manuales").set("manual-evt-1", manualSale())

    const res = await reconcileHandler(new Request("https://kunzera.com"), FAKE_CTX)
    const data = await res.json()

    expect(data.sheetOk).toBe(false)
    expect(data.resent).toBe(1) // la manual se reenvió igual
    expect(discordBodies(fm).join("")).toContain("Sheet")
  }, 15000)

  it("venta dentro de los 7 días: se manda con la fecha real; más vieja: se manda con 'ahora'", async () => {
    const fm = installFetchMock()
    // 5 días atrás → dentro de la ventana de 7 días de Meta
    const fiveDaysAgo = "2026-08-01"
    // 9 días atrás → fuera de los 7 días
    const nineDaysAgo = "2026-07-28"
    mockSheet(fm, [
      order({ idempotencykey: "reciente", timestamp: `${fiveDaysAgo}T15:00:00.000Z` }),
      order({ idempotencykey: "antigua", timestamp: `${nineDaysAgo}T15:00:00.000Z` }),
    ])
    mockMeta(fm)
    mockDiscord(fm)

    await reconcileHandler(new Request("https://kunzera.com"), FAKE_CTX)

    const events = fm
      .callsTo("graph.facebook.com")
      .map((c) => JSON.parse(String(c.init?.body)).data[0])
    const reciente = events.find((e) => e.event_id === "reciente")
    const antigua = events.find((e) => e.event_id === "antigua")
    const nowSec = Math.floor(NOW.getTime() / 1000)
    expect(reciente.event_time).toBe(Math.floor(new Date(`${fiveDaysAgo}T15:00:00.000Z`).getTime() / 1000))
    expect(antigua.event_time).toBeGreaterThanOrEqual(nowSec - 5) // "ahora"
  })
})
