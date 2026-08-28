import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeGetStore, resetBlobsMock } from "./helpers/blobsMock"
import { installFetchMock, jsonResponse } from "./helpers/fetchMock"

vi.mock("@netlify/blobs", () => ({ getStore: (name: string) => fakeGetStore(name) }))

const { default: funnelHandler } = await import("../capi-funnel.mts")

function req(body: Record<string, unknown>, userAgent = "Mozilla/5.0 Visitante") {
  return new Request("https://kunzera.com/api/capi-funnel", {
    method: "POST",
    headers: { "Content-Type": "application/json", "user-agent": userAgent },
    body: JSON.stringify(body),
  })
}

describe("capi-funnel", () => {
  beforeEach(() => {
    resetBlobsMock()
    process.env.META_CAPI_ACCESS_TOKEN = "test-token"
  })

  it("manda a Meta el evento con la IP real del request (ctx.ip) y el user-agent", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const ctx = { ip: "201.201.201.201" } as any

    await funnelHandler(req({ eventId: "cf-lead-1", event: "Lead", whatsapp: "1123456789" }), ctx)

    const userData = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0].user_data
    expect(userData.client_ip_address).toBe("201.201.201.201")
    expect(userData.client_user_agent).toBe("Mozilla/5.0 Visitante")
    expect(userData.ph[0]).toHaveLength(64)
  })

  it("acepta InitiateCheckout", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const ctx = { ip: "1.2.3.4" } as any

    await funnelHandler(req({ eventId: "cf-ic-1", event: "InitiateCheckout", value: 50000 }), ctx)

    const body = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    expect(body.data[0].event_name).toBe("InitiateCheckout")
    expect(body.data[0].custom_data.value).toBe(50000)
  })

  it("acepta ViewContent y AddToCart (nuevos eventos server-side)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const ctx = { ip: "1.2.3.4" } as any

    await funnelHandler(
      req({
        eventId: "cf-vc-1",
        event: "ViewContent",
        contentIds: ["platino", "diamante"],
        contentType: "product_group",
        contentName: "pricing_section",
      }),
      ctx,
    )
    await funnelHandler(
      req({ eventId: "cf-atc-1", event: "AddToCart", value: 70000, contentIds: ["diamante"] }),
      ctx,
    )

    const bodies = fm.callsTo("graph.facebook.com").map((c) => JSON.parse(String(c.init?.body)))
    expect(bodies[0].data[0].event_name).toBe("ViewContent")
    // contentIds llega tal cual, sin pasar por la conversión de slug
    expect(bodies[0].data[0].custom_data.content_ids).toEqual(["platino", "diamante"])
    expect(bodies[0].data[0].custom_data.content_type).toBe("product_group")
    // ViewContent de la sección no lleva value (no es una compra con monto)
    expect(bodies[0].data[0].custom_data.value).toBeUndefined()
    expect(bodies[1].data[0].event_name).toBe("AddToCart")
    expect(bodies[1].data[0].custom_data.value).toBe(70000)
    expect(bodies[1].data[0].custom_data.content_ids).toEqual(["diamante"])
  })

  it("acepta turno_seleccionado y Schedule (item 03: las dos señales de turno)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const ctx = { ip: "1.2.3.4" } as any

    await funnelHandler(req({ eventId: "cf-sel-1", event: "turno_seleccionado", value: 50000 }), ctx)
    await funnelHandler(req({ eventId: "cf-sch-1", event: "Schedule", value: 70000, whatsapp: "1155554444" }), ctx)

    const bodies = fm.callsTo("graph.facebook.com").map((c) => JSON.parse(String(c.init?.body)))
    expect(bodies[0].data[0].event_name).toBe("turno_seleccionado")
    expect(bodies[0].data[0].custom_data.value).toBe(50000)
    expect(bodies[0].data[0].action_source).toBe("website")
    expect(bodies[1].data[0].event_name).toBe("Schedule")
    expect(bodies[1].data[0].custom_data.value).toBe(70000)
    expect(bodies[1].data[0].user_data.ph[0]).toHaveLength(64)
  })

  it("turno_seleccionado y Schedule también respetan META_CAPI_TEST_EVENT_CODE", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    process.env.META_CAPI_TEST_EVENT_CODE = "TESTQ"
    const ctx = { ip: "1.2.3.4" } as any
    try {
      await funnelHandler(req({ eventId: "cf-tsel-tc", event: "turno_seleccionado" }), ctx)
      const body = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
      expect(body.test_event_code).toBe("TESTQ")
    } finally {
      delete process.env.META_CAPI_TEST_EVENT_CODE
    }
  })

  it("un array gigante de contentIds se recorta a 5", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const ctx = { ip: "1.2.3.4" } as any
    const many = Array.from({ length: 50 }, (_, i) => `x${i}`)

    await funnelHandler(req({ eventId: "cf-many", event: "AddToCart", contentIds: many }), ctx)

    const body = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    expect(body.data[0].custom_data.content_ids).toHaveLength(5)
  })

  it("un event_name no permitido (ej. Purchase) no manda nada a Meta", async () => {
    const fm = installFetchMock()
    const ctx = { ip: "1.2.3.4" } as any

    const res = await funnelHandler(req({ eventId: "cf-bad-evt", event: "Purchase", value: 999999 }), ctx)

    expect(res.status).toBe(200)
    expect(fm.calls.length).toBe(0)
  })

  it("un eventId inválido no manda nada a Meta", async () => {
    const fm = installFetchMock()
    const ctx = { ip: "1.2.3.4" } as any

    const res = await funnelHandler(req({ eventId: "; drop table--", event: "Lead" }), ctx)

    expect(res.status).toBe(200)
    expect(fm.calls.length).toBe(0)
  })

  it("sin eventId o sin event no manda nada", async () => {
    const fm = installFetchMock()
    const ctx = { ip: "1.2.3.4" } as any

    await funnelHandler(req({ event: "Lead" }), ctx)
    await funnelHandler(req({ eventId: "cf-missing" }), ctx)

    expect(fm.calls.length).toBe(0)
  })

  it("respeta el límite de requests por IP", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const ctx = { ip: "9.9.9.9" } as any

    for (let i = 0; i < 150; i++) {
      await funnelHandler(req({ eventId: `cf-rl-${i}`, event: "Lead" }), ctx)
    }
    const callsAfterLimit = fm.calls.length
    await funnelHandler(req({ eventId: "cf-rl-extra", event: "Lead" }), ctx)

    expect(fm.calls.length).toBe(callsAfterLimit)
  })

  it("un método distinto de POST no hace nada", async () => {
    const fm = installFetchMock()
    const ctx = { ip: "1.2.3.4" } as any

    const res = await funnelHandler(
      new Request("https://kunzera.com/api/capi-funnel", { method: "GET" }),
      ctx,
    )

    expect(res.status).toBe(200)
    expect(fm.calls.length).toBe(0)
  })
})
