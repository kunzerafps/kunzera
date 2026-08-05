import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeGetStore, resetBlobsMock } from "./helpers/blobsMock"
import { installFetchMock, jsonResponse } from "./helpers/fetchMock"

vi.mock("@netlify/blobs", () => ({ getStore: (name: string) => fakeGetStore(name) }))

const { createSessionToken } = await import("../lib/adminSession")
const { default: ventaManualHandler } = await import("../capi-venta-manual.mts")

const FAKE_CTX = { ip: "200.1.2.3" } as any

function req(body: Record<string, unknown>) {
  return new Request("https://kunzera.com/api/capi-venta-manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("capi-venta-manual (ventas offline por WhatsApp)", () => {
  let token: string

  beforeEach(() => {
    resetBlobsMock()
    process.env.ADMIN_SESSION_SECRET = "test-admin-secret"
    process.env.META_CAPI_ACCESS_TOKEN = "test-meta-token"
    delete process.env.MP_DISCORD_WEBHOOK_URL
    token = createSessionToken()!
  })

  it("dos compras distintas del mismo cliente y mismo monto, en días distintos, SÍ se registran por separado", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    const base = { token, nombre: "Cliente Recurrente", whatsapp: "1155554444", monto: 50000 }
    await ventaManualHandler(req({ ...base, fecha: "2026-08-01" }), FAKE_CTX)
    await ventaManualHandler(req({ ...base, fecha: "2026-08-02" }), FAKE_CTX)

    expect(fm.callsTo("graph.facebook.com")).toHaveLength(2)
    const [first, second] = fm.callsTo("graph.facebook.com")
    const firstId = JSON.parse(String(first.init?.body)).data[0].event_id
    const secondId = JSON.parse(String(second.init?.body)).data[0].event_id
    expect(firstId).not.toBe(secondId)
  })

  it("la misma carga (mismo teléfono+monto+día) mandada dos veces por error no duplica la venta", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    const body = { token, nombre: "Cliente", whatsapp: "1155554444", monto: 50000, fecha: "2026-08-01" }
    await ventaManualHandler(req(body), FAKE_CTX)
    await ventaManualHandler(req(body), FAKE_CTX) // carga duplicada por error

    expect(fm.callsTo("graph.facebook.com")).toHaveLength(1)
  })

  it("rechaza una fecha futura", async () => {
    const mañana = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const res = await ventaManualHandler(
      req({ token, nombre: "Cliente", whatsapp: "1155554444", monto: 50000, fecha: mañana }),
      FAKE_CTX,
    )
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.error).toBe("fecha_futura")
  })

  it("rechaza una fecha de más de 7 días atrás", async () => {
    const hace10dias = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const res = await ventaManualHandler(
      req({ token, nombre: "Cliente", whatsapp: "1155554444", monto: 50000, fecha: hace10dias }),
      FAKE_CTX,
    )
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.error).toBe("fecha_muy_vieja")
  })

  it("rechaza un WhatsApp inválido (muy corto / solo espacios) antes de mandar nada a Meta", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    const res = await ventaManualHandler(
      req({ token, nombre: "Cliente", whatsapp: "   ", monto: 50000 }),
      FAKE_CTX,
    )
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(fm.callsTo("graph.facebook.com")).toHaveLength(0)
  })

  it("event_time nunca queda en el futuro al cargar una venta de 'hoy' antes del mediodía Argentina (bug real encontrado probando en vivo)", async () => {
    // Simula las 8:00 UTC (5:00 de la mañana en Argentina, UTC-3) de un día
    // fijo — antes de las 15:00 UTC que usa el cálculo de "mediodía
    // Argentina". Meta rechazó exactamente este caso en una prueba real:
    // "La marca de tiempo del evento es posterior a la actual".
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-05T08:00:00Z"))
    try {
      const fm = installFetchMock()
      fm.on("graph.facebook.com", () => jsonResponse({}))

      await ventaManualHandler(
        req({ token, nombre: "Cliente", whatsapp: "1155554444", monto: 50000, fecha: "2026-08-05" }),
        FAKE_CTX,
      )

      const sentBody = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
      const nowSeconds = Math.floor(Date.now() / 1000)
      expect(sentBody.data[0].event_time).toBeLessThanOrEqual(nowSeconds)
    } finally {
      vi.useRealTimers()
    }
  })

  it("usa business_messaging como action_source (no 'website', no llega por el sitio)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await ventaManualHandler(
      req({ token, nombre: "Cliente", whatsapp: "1155554444", monto: 50000 }),
      FAKE_CTX,
    )

    const sentBody = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    expect(sentBody.data[0].action_source).toBe("business_messaging")
  })
})
