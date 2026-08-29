import { beforeEach, describe, expect, it } from "vitest"
import { vi } from "vitest"
import { fakeGetStore, resetBlobsMock } from "./helpers/blobsMock"
import { installFetchMock, jsonResponse } from "./helpers/fetchMock"

vi.mock("@netlify/blobs", () => ({ getStore: (name: string) => fakeGetStore(name) }))

const { sendMetaFunnelEvent, sendConfirmedBookingScheduleEvent } = await import(
  "../lib/metaCapiFunnel"
)

async function sha256HexRef(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest("SHA-256", enc)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

describe("sendMetaFunnelEvent", () => {
  beforeEach(() => {
    resetBlobsMock()
    process.env.META_CAPI_ACCESS_TOKEN = "test-token"
    delete process.env.META_CAPI_TEST_EVENT_CODE
  })

  it("en el deploy de prueba (META_CAPI_TEST_EVENT_CODE) el evento va a Eventos de prueba", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    process.env.META_CAPI_TEST_EVENT_CODE = "TESTXYZ"

    await sendMetaFunnelEvent({ eventId: "f-tc", eventName: "ViewContent", contentIds: ["platino"] })

    const body = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    expect(body.test_event_code).toBe("TESTXYZ")
  })

  it("manda el event_name recibido con action_source website + event_source_url", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaFunnelEvent({ eventId: "f-1", eventName: "Lead" })

    const body = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    expect(body.data[0].event_name).toBe("Lead")
    expect(body.data[0].action_source).toBe("website")
    expect(body.data[0].event_source_url).toBeTruthy()
    expect(body.data[0].event_id).toBe("f-1")
  })

  it("hashea teléfono, nombre y external_id con SHA-256 (nada de texto plano)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaFunnelEvent({
      eventId: "f-2",
      eventName: "Lead",
      whatsapp: "01123456789",
      nombre: "Juan Carlos Pérez",
      externalId: "abc-123-VID",
    })

    const userData = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0].user_data
    expect(userData.ph[0]).toBe(await sha256HexRef("5491123456789"))
    expect(userData.fn[0]).toBe(await sha256HexRef("juan carlos"))
    expect(userData.ln[0]).toBe(await sha256HexRef("perez"))
    expect(userData.external_id[0]).toBe(await sha256HexRef("abc-123-vid"))
    const serialized = JSON.stringify(userData)
    expect(serialized).not.toContain("1123456789")
    expect(serialized).not.toContain("Juan")
  })

  it("hashea la geo (ct/st/zp/country) igual que el evento de Compra", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaFunnelEvent({
      eventId: "f-geo",
      eventName: "Lead",
      city: "La Plata",
      region: "Buenos Aires",
      postalCode: "1900",
      countryCode: "AR",
    })

    const userData = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0].user_data
    expect(userData.ct[0]).toBe(await sha256HexRef("laplata"))
    expect(userData.st[0]).toBe(await sha256HexRef("buenosaires"))
    expect(userData.zp[0]).toBe(await sha256HexRef("1900"))
    expect(userData.country[0]).toBe(await sha256HexRef("ar"))
  })

  it("agrega partner_agent a nivel de evento", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaFunnelEvent({ eventId: "f-pa", eventName: "Lead" })

    const body = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    expect(body.data[0].partner_agent).toBe("kunzera-web")
  })

  it("manda fbp/fbc/ip/user-agent sin hashear", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaFunnelEvent({
      eventId: "f-3",
      eventName: "InitiateCheckout",
      fbp: "fb.1.111.222",
      fbc: "fb.1.111.IwAR_real",
      clientIpAddress: "200.1.2.3",
      clientUserAgent: "Mozilla/5.0 Test",
    })

    const userData = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0].user_data
    expect(userData.fbp).toBe("fb.1.111.222")
    expect(userData.fbc).toBe("fb.1.111.IwAR_real")
    expect(userData.client_ip_address).toBe("200.1.2.3")
    expect(userData.client_user_agent).toBe("Mozilla/5.0 Test")
  })

  it("resuelve content_name al nombre visible del pack y conserva el slug en content_ids", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaFunnelEvent({
      eventId: "f-4",
      eventName: "InitiateCheckout",
      value: 70000,
      currency: "ARS",
      contentName: "diamante",
    })

    const customData = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0].custom_data
    expect(customData.value).toBe(70000)
    expect(customData.currency).toBe("ARS")
    expect(customData.content_name).toBe("Diamante")
    expect(customData.content_ids).toEqual(["diamante"])
    expect(customData.content_type).toBe("product")
  })

  it("modo nuevo: si viene contentIds se usa tal cual, sin conversión de slug", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaFunnelEvent({
      eventId: "f-4b",
      eventName: "ViewContent",
      contentName: "pricing_section",
      contentIds: ["platino", "diamante"],
      contentType: "product_group",
    })

    const customData = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0].custom_data
    expect(customData.content_ids).toEqual(["platino", "diamante"])
    expect(customData.content_type).toBe("product_group")
    expect(customData.content_name).toBe("pricing_section") // texto libre, no se toca
  })

  it("Contact: contentName es de dónde tocó WhatsApp, va como texto libre sin content_ids de producto", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaFunnelEvent({
      eventId: "f-contact",
      eventName: "Contact",
      externalId: "vid-abc",
      contentName: "whatsapp_float",
    })

    const data = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0]
    expect(data.event_name).toBe("Contact")
    expect(data.custom_data.content_name).toBe("whatsapp_float")
    expect(data.custom_data.content_ids).toBeUndefined()
    expect(data.custom_data.content_type).toBeUndefined()
    expect(data.user_data.external_id[0]).toHaveLength(64) // el id de navegador sí viaja (hasheado)
  })

  it("Lead ahora puede llevar value (precio del pack) para optimización por plata", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaFunnelEvent({
      eventId: "f-lead-val",
      eventName: "Lead",
      value: 50000,
      currency: "ARS",
      contentName: "Platino",
      contentIds: ["platino"],
      contentType: "product",
    })

    const customData = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0].custom_data
    expect(customData.value).toBe(50000)
    expect(customData.content_ids).toEqual(["platino"])
  })

  it("no manda custom_data cuando no hay value ni contentName (ej. Lead pelado)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaFunnelEvent({ eventId: "f-5", eventName: "Lead" })

    const body = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    expect(body.data[0].custom_data).toBeUndefined()
  })

  it("no reenvía el mismo eventId dos veces (dedup local)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaFunnelEvent({ eventId: "f-dup", eventName: "Lead" })
    await sendMetaFunnelEvent({ eventId: "f-dup", eventName: "Lead" })

    expect(fm.callsTo("graph.facebook.com").length).toBe(1)
  })

  it("usa un store de dedup separado del de Purchase y del de PageView", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaFunnelEvent({ eventId: "evt-x", eventName: "Lead" })

    expect(await fakeGetStore("capi-funnel-events-sent").get("evt-x")).not.toBeNull()
    expect(await fakeGetStore("capi-events-sent").get("evt-x")).toBeNull()
    expect(await fakeGetStore("capi-pageview-events-sent").get("evt-x")).toBeNull()
  })

  it("sin token configurado no llama a Meta y devuelve error", async () => {
    delete process.env.META_CAPI_ACCESS_TOKEN
    const fm = installFetchMock()

    const result = await sendMetaFunnelEvent({ eventId: "f-6", eventName: "Lead" })

    expect(result.ok).toBe(false)
    expect(fm.calls.length).toBe(0)
  })

  it("un fallo de Meta no marca el evento como enviado y permite reintentar", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({ error: { message: "bad token" } }, 401))

    const first = await sendMetaFunnelEvent({ eventId: "f-retry", eventName: "Lead" })
    expect(first.ok).toBe(false)
    expect(await fakeGetStore("capi-funnel-events-sent").get("f-retry")).toBeNull()

    fm.reset()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const second = await sendMetaFunnelEvent({ eventId: "f-retry", eventName: "Lead" })
    expect(second.ok).toBe(true)
  })

  it("un fallo de red (fetch rechaza) se maneja sin tirar", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => {
      throw new Error("network down")
    })

    const result = await sendMetaFunnelEvent({ eventId: "f-7", eventName: "InitiateCheckout" })

    expect(result.ok).toBe(false)
    expect(await fakeGetStore("capi-funnel-events-sent").get("f-7")).toBeNull()
  })

  describe("sendConfirmedBookingScheduleEvent (G2: Schedule server-side)", () => {
    it("manda Schedule con event_id '<key>-schedule', value/currency y teléfono hasheado", async () => {
      const fm = installFetchMock()
      fm.on("graph.facebook.com", () => jsonResponse({}))

      const r = await sendConfirmedBookingScheduleEvent({
        idempotencyKey: "abc123",
        value: 70000,
        contentName: "diamante",
        whatsapp: "1155554444",
        nombre: "Juan Perez",
        externalId: "vid-1",
      })

      expect(r.ok).toBe(true)
      const data = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0]
      expect(data.event_name).toBe("Schedule")
      expect(data.event_id).toBe("abc123-schedule")
      expect(data.action_source).toBe("website")
      expect(data.custom_data.value).toBe(70000)
      expect(data.custom_data.currency).toBe("ARS")
      expect(data.custom_data.content_ids).toEqual(["diamante"])
      expect(data.user_data.ph[0]).toHaveLength(64)
    })

    it("value 0 / inválido NO se manda (no envenena la optimización por valor)", async () => {
      const fm = installFetchMock()
      fm.on("graph.facebook.com", () => jsonResponse({}))

      await sendConfirmedBookingScheduleEvent({ idempotencyKey: "z", value: 0 })

      const data = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0]
      expect(data.custom_data?.value).toBeUndefined()
    })

    it("mismo <key>-schedule dos veces (webhook + 'Marcar como atendido') deduplica: un solo envío", async () => {
      const fm = installFetchMock()
      fm.on("graph.facebook.com", () => jsonResponse({}))

      await sendConfirmedBookingScheduleEvent({ idempotencyKey: "dup-key", value: 50000 })
      await sendConfirmedBookingScheduleEvent({ idempotencyKey: "dup-key", value: 50000 })

      expect(fm.callsTo("graph.facebook.com").length).toBe(1)
    })
  })
})
