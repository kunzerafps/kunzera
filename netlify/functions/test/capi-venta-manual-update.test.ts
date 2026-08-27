import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeGetStore, resetBlobsMock } from "./helpers/blobsMock"
import { installFetchMock, jsonResponse } from "./helpers/fetchMock"

vi.mock("@netlify/blobs", () => ({ getStore: (name: string) => fakeGetStore(name) }))

const { createSessionToken } = await import("../lib/adminSession")
const { default: ventaManualHandler } = await import("../capi-venta-manual.mts")
const { default: updateHandler } = await import("../capi-venta-manual-update.mts")
const { listManualSales } = await import("../lib/manualSalesStore")

const FAKE_CTX = { ip: "200.1.2.3" } as any

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

let TOKEN: string

function createReq(body: Record<string, unknown>) {
  return new Request("https://kunzera.com/api/capi-venta-manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}
function updateReq(body: Record<string, unknown>) {
  return new Request("https://kunzera.com/api/capi-venta-manual-update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function cargarVenta(overrides: Record<string, unknown> = {}) {
  const res = await ventaManualHandler(
    createReq({
      token: TOKEN,
      nombre: "Cliente",
      whatsapp: "1155554444",
      email: "cliente@mail.com",
      monto: 50000,
      fecha: daysAgoISO(1),
      ...overrides,
    }),
    FAKE_CTX,
  )
  return res.json()
}

describe("capi-venta-manual-update", () => {
  beforeEach(() => {
    resetBlobsMock()
    process.env.ADMIN_SESSION_SECRET = "test-admin-secret"
    process.env.META_CAPI_ACCESS_TOKEN = "test-meta-token"
    delete process.env.MP_DISCORD_WEBHOOK_URL
    TOKEN = createSessionToken()!
  })

  it("cancelar marca la venta y reactivar la vuelve a activar", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const { id } = await cargarVenta()
    const [v] = await listManualSales()

    await updateHandler(updateReq({ token: TOKEN, eventId: v.metaEventId, action: "cancel" }), FAKE_CTX)
    expect((await listManualSales())[0].canceled).toBe(true)
    expect((await listManualSales())[0].id).toBe(id) // el id no cambia

    await updateHandler(updateReq({ token: TOKEN, eventId: v.metaEventId, action: "reactivate" }), FAKE_CTX)
    expect((await listManualSales())[0].canceled).toBe(false)
  })

  it("reintentar una venta pendiente que ahora sí entra deja el estado en ok", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({ error: "meta caido" }, 500))
    await cargarVenta()
    let [v] = await listManualSales()
    expect(v.metaStatus).toBe("error")

    // Meta se recupera
    fm.reset()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const res = await updateHandler(
      updateReq({ token: TOKEN, eventId: v.metaEventId, action: "retry-meta" }),
      FAKE_CTX,
    )
    const data = await res.json()
    expect(data.ok).toBe(true)
    ;[v] = await listManualSales()
    expect(v.metaStatus).toBe("ok")
  })

  it("no se puede reintentar una venta de más de 7 días", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({ error: "meta caido" }, 500))
    // cargarla con fecha de 6 días atrás (todavía válida al cargar)…
    await cargarVenta({ fecha: daysAgoISO(6) })
    const [v] = await listManualSales()

    // …y simular que ya pasaron varios días más antes de reintentar.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000))
    try {
      // Token nuevo bajo el reloj falso — el de beforeEach ya venció al
      // saltar la fecha.
      const freshToken = createSessionToken()!
      fm.reset()
      fm.on("graph.facebook.com", () => jsonResponse({}))
      const res = await updateHandler(
        updateReq({ token: freshToken, eventId: v.metaEventId, action: "retry-meta" }),
        FAKE_CTX,
      )
      const data = await res.json()
      expect(data.ok).toBe(false)
      expect(data.error).toBe("fecha_muy_vieja")
      expect(fm.callsTo("graph.facebook.com")).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("rechaza sin token de admin válido", async () => {
    const res = await updateHandler(
      updateReq({ token: "trucho", eventId: "x", action: "cancel" }),
      FAKE_CTX,
    )
    expect(res.status).toBe(401)
  })

  it("404 si la venta no existe", async () => {
    const res = await updateHandler(
      updateReq({ token: TOKEN, eventId: "no-existe", action: "cancel" }),
      FAKE_CTX,
    )
    expect(res.status).toBe(404)
  })
})
