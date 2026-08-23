import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeGetStore, resetBlobsMock } from "./helpers/blobsMock"
import { installFetchMock, jsonResponse } from "./helpers/fetchMock"

vi.mock("@netlify/blobs", () => ({ getStore: (name: string) => fakeGetStore(name) }))

const { default: pageViewHandler } = await import("../capi-pageview.mts")

function req(body: Record<string, unknown>, userAgent = "Mozilla/5.0 Visitante") {
  return new Request("https://kunzera.com/api/capi-pageview", {
    method: "POST",
    headers: { "Content-Type": "application/json", "user-agent": userAgent },
    body: JSON.stringify(body),
  })
}

describe("capi-pageview", () => {
  beforeEach(() => {
    resetBlobsMock()
    process.env.META_CAPI_ACCESS_TOKEN = "test-token"
  })

  it("manda el evento a Meta con la IP real del request (ctx.ip) y el user-agent", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const ctx = { ip: "201.201.201.201" } as any

    await pageViewHandler(req({ eventId: "pv-http-1" }, "Mozilla/5.0 Visitante"), ctx)

    const call = fm.callsTo("graph.facebook.com")[0]
    const body = JSON.parse(String(call.init?.body))
    expect(body.data[0].user_data.client_ip_address).toBe("201.201.201.201")
    expect(body.data[0].user_data.client_user_agent).toBe("Mozilla/5.0 Visitante")
  })

  it("un eventId inválido no manda nada a Meta", async () => {
    const fm = installFetchMock()
    const ctx = { ip: "201.201.201.201" } as any

    const res = await pageViewHandler(req({ eventId: "; drop table--" }), ctx)

    expect(res.status).toBe(200) // nunca rompe la experiencia del visitante
    expect(fm.calls.length).toBe(0)
  })

  it("sin eventId no manda nada a Meta", async () => {
    const fm = installFetchMock()
    const ctx = { ip: "201.201.201.201" } as any

    const res = await pageViewHandler(req({}), ctx)

    expect(res.status).toBe(200)
    expect(fm.calls.length).toBe(0)
  })

  it("respeta el límite de requests por IP (evita abuso del endpoint público)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const ctx = { ip: "201.201.201.201" } as any

    for (let i = 0; i < 20; i++) {
      await pageViewHandler(req({ eventId: `pv-rl-${i}` }), ctx)
    }
    const callsAfterLimit = fm.calls.length
    await pageViewHandler(req({ eventId: "pv-rl-excedido" }), ctx)

    expect(fm.calls.length).toBe(callsAfterLimit) // el request 21 no generó una llamada nueva
  })

  it("un método distinto de POST no hace nada", async () => {
    const fm = installFetchMock()
    const ctx = { ip: "201.201.201.201" } as any

    const res = await pageViewHandler(
      new Request("https://kunzera.com/api/capi-pageview", { method: "GET" }),
      ctx,
    )

    expect(res.status).toBe(200)
    expect(fm.calls.length).toBe(0)
  })
})
