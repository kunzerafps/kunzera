import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeGetStore, resetBlobsMock } from "./helpers/blobsMock"

vi.mock("@netlify/blobs", () => ({ getStore: (name: string) => fakeGetStore(name) }))

const { createSessionToken } = await import("../lib/adminSession")
const { saveAttribution } = await import("../lib/attribution")
const { default: getAttributionHandler } = await import("../get-attribution.mts")

const FAKE_CTX = { ip: "200.1.2.3" } as any

function req(body: Record<string, unknown>) {
  return new Request("https://kunzera.com/api/get-attribution", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("get-attribution", () => {
  let token: string

  beforeEach(() => {
    resetBlobsMock()
    process.env.ADMIN_SESSION_SECRET = "test-admin-secret"
    token = createSessionToken()!
  })

  it("devuelve los campos utm guardados para esa reserva", async () => {
    await saveAttribution("order-1", {
      utmSource: "facebook",
      utmMedium: "cpc",
      utmCampaign: "verano_promo",
      fbp: "fb.1.1.1",
      capturedAt: Date.now(),
    })

    const res = await getAttributionHandler(req({ token, idempotencyKey: "order-1" }), FAKE_CTX)
    const data = await res.json()

    expect(data.ok).toBe(true)
    expect(data.utmSource).toBe("facebook")
    expect(data.utmMedium).toBe("cpc")
    expect(data.utmCampaign).toBe("verano_promo")
  })

  it("nunca devuelve ip/userAgent/fbp/fbc — solo lo que necesita mostrar el panel", async () => {
    await saveAttribution("order-2", {
      fbp: "fb.1.1.1",
      ip: "9.9.9.9",
      userAgent: "algo",
      capturedAt: Date.now(),
    })

    const res = await getAttributionHandler(req({ token, idempotencyKey: "order-2" }), FAKE_CTX)
    const data = await res.json()

    expect(data.ip).toBeUndefined()
    expect(data.userAgent).toBeUndefined()
    expect(data.fbp).toBeUndefined()
    expect(data.fbc).toBeUndefined()
  })

  it("reserva sin ningún dato de atribución guardado: responde ok igual, todo undefined", async () => {
    const res = await getAttributionHandler(req({ token, idempotencyKey: "order-sin-datos" }), FAKE_CTX)
    const data = await res.json()

    expect(data.ok).toBe(true)
    expect(data.utmSource).toBeUndefined()
  })

  it("rechaza sin token de sesión válido", async () => {
    const res = await getAttributionHandler(
      req({ token: "token-trucho", idempotencyKey: "order-1" }),
      FAKE_CTX,
    )
    expect(res.status).toBe(401)
  })

  it("rechaza una idempotencyKey con formato inválido", async () => {
    const res = await getAttributionHandler(req({ token, idempotencyKey: "; drop table--" }), FAKE_CTX)
    expect(res.status).toBe(400)
  })
})
