import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeGetStore, resetBlobsMock } from "./helpers/blobsMock"
import { installFetchMock, jsonResponse } from "./helpers/fetchMock"

vi.mock("@netlify/blobs", () => ({ getStore: (name: string) => fakeGetStore(name) }))

const { createSessionToken } = await import("../lib/adminSession")
const { default: ingresosHandler } = await import("../admin-ingresos.mts")
const { saveManualSale } = await import("../lib/manualSalesStore")

const FAKE_CTX = {} as any

function req(qs: string) {
  return new Request(`https://kunzera.com/api/admin-ingresos${qs}`, { method: "GET" })
}

function hoy(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function sheetOrder(o: Partial<Record<string, unknown>>) {
  return {
    timestamp: new Date().toISOString(),
    nombre: "Cliente",
    whatsapp: "1155550001",
    discord: "",
    plan: "platino",
    monto: 50000,
    turno: "",
    comprobante: "",
    estado: "confirmado",
    idempotencykey: "k",
    ...o,
  }
}

async function seedManual(o: Partial<Record<string, unknown>>) {
  await saveManualSale({
    id: "KZM-1",
    createdAt: Date.now(),
    saleDate: hoy(),
    nombre: "WA Cliente",
    whatsapp: "1155550002",
    email: "wa@mail.com",
    monto: 70000,
    campania: "Reel PC lenta",
    metaEventId: "evt-" + Math.random(),
    metaStatus: "ok",
    ...o,
  } as any)
}

describe("admin-ingresos", () => {
  let token: string
  beforeEach(() => {
    resetBlobsMock()
    process.env.ADMIN_SESSION_SECRET = "s"
    process.env.META_MARKETING_ACCESS_TOKEN = "mkt"
    token = createSessionToken()!
  })

  it("rechaza sin token", async () => {
    const res = await ingresosHandler(req(""), FAKE_CTX)
    expect(res.status).toBe(401)
  })

  it("junta ventas web + WhatsApp + gasto de Meta y calcula el retorno", async () => {
    const fm = installFetchMock()
    fm.on("script.google.com", () =>
      jsonResponse({ ok: true, orders: [sheetOrder({}), sheetOrder({ estado: "pendiente" })] }),
    )
    fm.on("graph.facebook.com", () =>
      jsonResponse({ data: [{ spend: "20000", campaign_name: "Reel PC lenta", account_currency: "ARS" }] }),
    )
    await seedManual({})

    const res = await ingresosHandler(req(`?token=${token}&days=30`), FAKE_CTX)
    const d = await res.json()
    expect(d.ok).toBe(true)
    expect(d.web.ventas).toBe(1) // la "pendiente" no cuenta
    expect(d.web.ingresos).toBe(50000)
    expect(d.whatsapp.ventas).toBe(1)
    expect(d.whatsapp.ingresos).toBe(70000)
    expect(d.totales.ingresos).toBe(120000)
    expect(d.totales.gasto).toBe(20000)
    expect(d.totales.retorno).toBe(6) // 120000 / 20000
    // el gasto de la campaña se cruza por nombre
    const camp = d.porCampana.find((c: any) => c.campana === "Reel PC lenta")
    expect(camp.gasto).toBe(20000)
  })

  it("si el gasto de Meta falla, muestra el resto y lo avisa", async () => {
    const fm = installFetchMock()
    fm.on("script.google.com", () => jsonResponse({ ok: true, orders: [sheetOrder({})] }))
    fm.on("graph.facebook.com", () => jsonResponse({ error: { message: "sin permiso" } }, 400))

    const res = await ingresosHandler(req(`?token=${token}`), FAKE_CTX)
    const d = await res.json()
    expect(d.ok).toBe(true)
    expect(d.web.ingresos).toBe(50000)
    expect(d.meta.gasto).toBe(null)
    expect(d.meta.error).toContain("sin permiso")
    expect(d.totales.retorno).toBe(null)
  })

  it("detecta clientes que volvieron a comprar (item 17)", async () => {
    const fm = installFetchMock()
    // mismo teléfono en el Sheet y en una venta manual -> cliente recurrente
    fm.on("script.google.com", () =>
      jsonResponse({ ok: true, orders: [sheetOrder({ whatsapp: "+54 9 11 5555 9999", monto: 50000 })] }),
    )
    fm.on("graph.facebook.com", () => jsonResponse({ data: [] }))
    await seedManual({ whatsapp: "1155559999", monto: 70000, metaEventId: "evt-rec" })

    const res = await ingresosHandler(req(`?token=${token}`), FAKE_CTX)
    const d = await res.json()
    expect(d.recompra.clientesUnicos).toBe(1)
    expect(d.recompra.clientesQueVolvieron).toBe(1)
    expect(d.recompra.ventasDeRecompra).toBe(1)
  })
})
