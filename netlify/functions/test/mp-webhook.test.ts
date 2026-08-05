import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeGetStore, resetBlobsMock } from "./helpers/blobsMock"
import { installFetchMock, jsonResponse } from "./helpers/fetchMock"

vi.mock("@netlify/blobs", () => ({ getStore: (name: string) => fakeGetStore(name) }))

vi.mock("../../../src/lib/appsScript", () => ({
  submitOrder: vi.fn(),
  updateOrderStatus: vi.fn(),
}))

const { submitOrder, updateOrderStatus } = await import("../../../src/lib/appsScript")
const { default: mpWebhookHandler } = await import("../mp-webhook.mts")

const FAKE_CTX = {} as any

function mpNotification(paymentId: string) {
  return new Request("https://kunzera.com/api/mp-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "payment", data: { id: paymentId } }),
  })
}

function mpPaymentPayload(opts: { status: string; idempotencyKey: string; monto: number }) {
  return {
    status: opts.status,
    external_reference: opts.idempotencyKey,
    metadata: {
      nombre: "Cliente Test",
      whatsapp: "1123456789",
      discord: "-",
      plan: "diamante",
      turno: "2026-08-10T15:00:00.000Z",
      monto: opts.monto,
    },
  }
}

describe("mp-webhook: Purchase solo con pago approved", () => {
  beforeEach(() => {
    resetBlobsMock()
    vi.clearAllMocks()
    process.env.MP_ACCESS_TOKEN = "test-mp-token"
    process.env.META_CAPI_ACCESS_TOKEN = "test-meta-token"
    delete process.env.MP_WEBHOOK_SECRET // sin firma, más simple para el test
    delete process.env.MP_DISCORD_WEBHOOK_URL // así no hace falta mockear Discord
  })

  it("pago approved: genera un solo evento Purchase, con el precio base (no el total con comisión de MP)", async () => {
    const fm = installFetchMock()
    fm.on("api.mercadopago.com", () =>
      jsonResponse(mpPaymentPayload({ status: "approved", idempotencyKey: "key-approved-1", monto: 70000 })),
    )
    fm.on("graph.facebook.com", () => jsonResponse({}))

    vi.mocked(submitOrder).mockResolvedValue({ ok: true, fileUrl: "-", timestamp: new Date().toISOString() })
    vi.mocked(updateOrderStatus).mockResolvedValue({ ok: true, row: 1, estado: "confirmado" })

    const res = await mpWebhookHandler(mpNotification("approved-1"), FAKE_CTX)
    expect(res.status).toBe(200)

    const metaCalls = fm.callsTo("graph.facebook.com")
    expect(metaCalls).toHaveLength(1)
    const body = JSON.parse(String(metaCalls[0].init?.body))
    expect(body.data[0].event_name).toBe("Purchase")
    expect(body.data[0].custom_data.value).toBe(70000) // precio base, no 75.900 con comisión
    expect(body.data[0].event_id).toBe("key-approved-1")
  })

  it("pago pending: NO genera Purchase", async () => {
    const fm = installFetchMock()
    fm.on("api.mercadopago.com", () =>
      jsonResponse(mpPaymentPayload({ status: "pending", idempotencyKey: "key-pending-1", monto: 70000 })),
    )

    const res = await mpWebhookHandler(mpNotification("pending-1"), FAKE_CTX)
    expect(res.status).toBe(200)
    expect(fm.callsTo("graph.facebook.com")).toHaveLength(0)
    expect(submitOrder).not.toHaveBeenCalled()
  })

  it("pago rejected: NO genera Purchase", async () => {
    const fm = installFetchMock()
    fm.on("api.mercadopago.com", () =>
      jsonResponse(mpPaymentPayload({ status: "rejected", idempotencyKey: "key-rejected-1", monto: 50000 })),
    )

    const res = await mpWebhookHandler(mpNotification("rejected-1"), FAKE_CTX)
    expect(res.status).toBe(200)
    expect(fm.callsTo("graph.facebook.com")).toHaveLength(0)
  })

  it("reintento del webhook (misma notificación de pago dos veces) no duplica el Purchase", async () => {
    const fm = installFetchMock()
    fm.on("api.mercadopago.com", () =>
      jsonResponse(mpPaymentPayload({ status: "approved", idempotencyKey: "key-retry-1", monto: 50000 })),
    )
    fm.on("graph.facebook.com", () => jsonResponse({}))

    vi.mocked(submitOrder).mockResolvedValue({ ok: true, fileUrl: "-", timestamp: new Date().toISOString() })
    vi.mocked(updateOrderStatus).mockResolvedValue({ ok: true, row: 1, estado: "confirmado" })

    await mpWebhookHandler(mpNotification("retry-1"), FAKE_CTX)
    await mpWebhookHandler(mpNotification("retry-1"), FAKE_CTX) // MP reenvía la misma notificación

    expect(fm.callsTo("graph.facebook.com")).toHaveLength(1)
    // El reintento entero ni siquiera vuelve a llamar a submitOrder — lo
    // frena alreadyProcessed antes de llegar ahí.
    expect(submitOrder).toHaveBeenCalledTimes(1)
  })

  it("conserva el mismo event_id (external_reference de MP) entre el intento original y el reintento", async () => {
    const fm = installFetchMock()
    fm.on("api.mercadopago.com", () =>
      jsonResponse(mpPaymentPayload({ status: "approved", idempotencyKey: "key-stable-id", monto: 50000 })),
    )
    fm.on("graph.facebook.com", () => jsonResponse({}))
    vi.mocked(submitOrder).mockResolvedValue({ ok: true, fileUrl: "-", timestamp: new Date().toISOString() })
    vi.mocked(updateOrderStatus).mockResolvedValue({ ok: true, row: 1, estado: "confirmado" })

    await mpWebhookHandler(mpNotification("stable-1"), FAKE_CTX)

    const body = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    expect(body.data[0].event_id).toBe("key-stable-id")
  })
})
