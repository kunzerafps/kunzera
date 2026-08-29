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

// Desde G2, mp-webhook manda DOS eventos a Meta por venta confirmada:
// Purchase y Schedule (reserva confirmada, server-side). Helpers para
// assertar sobre cada uno sin depender del orden.
function metaEvent(fm: ReturnType<typeof installFetchMock>, name: string) {
  const call = fm
    .callsTo("graph.facebook.com")
    .find((c) => JSON.parse(String(c.init?.body)).data[0].event_name === name)
  return call ? JSON.parse(String(call.init?.body)).data[0] : undefined
}
function metaEventCount(fm: ReturnType<typeof installFetchMock>, name: string): number {
  return fm
    .callsTo("graph.facebook.com")
    .filter((c) => JSON.parse(String(c.init?.body)).data[0].event_name === name).length
}

function mpPaymentPayload(opts: {
  status: string
  idempotencyKey: string
  monto: number
  payer?: Record<string, unknown>
}) {
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
    ...(opts.payer ? { payer: opts.payer } : {}),
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

    expect(metaEventCount(fm, "Purchase")).toBe(1)
    const purchase = metaEvent(fm, "Purchase")
    expect(purchase.custom_data.value).toBe(70000) // precio base, no 75.900 con comisión
    expect(purchase.event_id).toBe("key-approved-1")

    // Schedule (reserva confirmada) sale junto con la Compra, server-side,
    // con su propio event_id — antes salía del navegador, antes de que este
    // webhook confirmara el pago.
    expect(metaEventCount(fm, "Schedule")).toBe(1)
    const schedule = metaEvent(fm, "Schedule")
    expect(schedule.event_id).toBe("key-approved-1-schedule")
    expect(schedule.custom_data.value).toBe(70000)
  })

  it("aprovecha el mail de la cuenta que pagó (payer.email) y lo manda hasheado como `em`", async () => {
    const fm = installFetchMock()
    fm.on("api.mercadopago.com", () =>
      jsonResponse(
        mpPaymentPayload({
          status: "approved",
          idempotencyKey: "key-payer-email",
          monto: 70000,
          payer: { email: "Comprador@Gmail.com  " },
        }),
      ),
    )
    fm.on("graph.facebook.com", () => jsonResponse({}))
    vi.mocked(submitOrder).mockResolvedValue({ ok: true, fileUrl: "-", timestamp: new Date().toISOString() })
    vi.mocked(updateOrderStatus).mockResolvedValue({ ok: true, row: 1, estado: "confirmado" })

    await mpWebhookHandler(mpNotification("payer-email-1"), FAKE_CTX)

    const em = metaEvent(fm, "Purchase").user_data.em
    expect(Array.isArray(em)).toBe(true)
    expect(em[0]).toMatch(/^[a-f0-9]{64}$/) // hasheado, no el mail en texto plano
    // el mail no aparece en texto plano en NINGUNA de las llamadas a Meta
    for (const c of fm.callsTo("graph.facebook.com")) {
      expect(String(c.init?.body)).not.toContain("Comprador@Gmail.com")
    }
  })

  it("sin payer.email, la Compra sale sin `em` (no rompe nada)", async () => {
    const fm = installFetchMock()
    fm.on("api.mercadopago.com", () =>
      jsonResponse(mpPaymentPayload({ status: "approved", idempotencyKey: "key-no-payer", monto: 50000 })),
    )
    fm.on("graph.facebook.com", () => jsonResponse({}))
    vi.mocked(submitOrder).mockResolvedValue({ ok: true, fileUrl: "-", timestamp: new Date().toISOString() })
    vi.mocked(updateOrderStatus).mockResolvedValue({ ok: true, row: 1, estado: "confirmado" })

    await mpWebhookHandler(mpNotification("no-payer-1"), FAKE_CTX)

    expect(metaEvent(fm, "Purchase").user_data.em).toBeUndefined()
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

  it("fallo transitorio de la reserva (Apps Script caído, no slot_taken): NI Purchase NI Schedule, y no marca procesado (deja reintentar)", async () => {
    const fm = installFetchMock()
    fm.on("api.mercadopago.com", () =>
      jsonResponse(mpPaymentPayload({ status: "approved", idempotencyKey: "key-transient", monto: 50000 })),
    )
    fm.on("graph.facebook.com", () => jsonResponse({}))
    fm.on("discord.com", () => jsonResponse({})) // notifyOrderFailed (por si MP_DISCORD_WEBHOOK_URL estuviera seteado)

    vi.mocked(submitOrder).mockResolvedValue({ ok: false, error: "apps_script_timeout" })

    const res = await mpWebhookHandler(mpNotification("transient-1"), FAKE_CTX)
    expect(res.status).toBe(200)
    // Sin reserva confirmada → ningún evento de conversión a Meta.
    expect(metaEventCount(fm, "Purchase")).toBe(0)
    expect(metaEventCount(fm, "Schedule")).toBe(0)
    // No se marca "procesado" → un reintento futuro de MP puede volver a intentar.
    expect(await fakeGetStore("mp-webhook-processed").get("key-transient")).toBeNull()
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

    expect(metaEventCount(fm, "Purchase")).toBe(1)
    expect(metaEventCount(fm, "Schedule")).toBe(1)
    // El reintento entero ni siquiera vuelve a llamar a submitOrder — lo
    // frena alreadyProcessed antes de llegar ahí.
    expect(submitOrder).toHaveBeenCalledTimes(1)
  })

  it("entrega cuya reserva ya existía (slot_taken + ownRow.ok): ahora SÍ manda el Purchase a Meta (antes se salteaba)", async () => {
    const fm = installFetchMock()
    fm.on("api.mercadopago.com", () =>
      jsonResponse(mpPaymentPayload({ status: "approved", idempotencyKey: "key-ownrow", monto: 70000 })),
    )
    fm.on("graph.facebook.com", () => jsonResponse({}))

    // submitOrder ve el turno "ocupado" por la propia reserva que una entrega
    // anterior creó antes de cortarse; updateOrderStatus confirma que la fila
    // es nuestra (ownRow.ok).
    vi.mocked(submitOrder).mockResolvedValue({ ok: false, error: "slot_taken" })
    vi.mocked(updateOrderStatus).mockResolvedValue({ ok: true, row: 1, estado: "confirmado" })

    await mpWebhookHandler(mpNotification("ownrow-1"), FAKE_CTX)

    expect(metaEventCount(fm, "Purchase")).toBe(1)
    expect(metaEvent(fm, "Purchase").event_id).toBe("key-ownrow")
    // el Schedule de recuperación también sale por esta rama
    expect(metaEvent(fm, "Schedule")?.event_id).toBe("key-ownrow-schedule")
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

    expect(metaEvent(fm, "Purchase").event_id).toBe("key-stable-id")
    expect(metaEvent(fm, "Schedule").event_id).toBe("key-stable-id-schedule")
  })
})
