import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeGetStore, resetBlobsMock } from "./helpers/blobsMock"
import { installFetchMock, jsonResponse } from "./helpers/fetchMock"

vi.mock("@netlify/blobs", () => ({ getStore: (name: string) => fakeGetStore(name) }))

const { sendMetaCancelEvent } = await import("../lib/metaCapiCancel")

async function sha256HexRef(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest("SHA-256", enc)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

describe("sendMetaCancelEvent", () => {
  beforeEach(() => {
    resetBlobsMock()
    process.env.META_CAPI_ACCESS_TOKEN = "test-token"
    delete process.env.META_CAPI_TEST_EVENT_CODE
  })

  it("manda un evento CompraCancelada con el order_id original, valor y PII hasheada", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaCancelEvent({
      eventId: "orig-event-123",
      value: 70000,
      whatsapp: "01123456789",
      nombre: "Ana Gómez",
      email: "  Ana@Mail.com ",
      countryCode: "ar",
    })

    const ev = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0]
    expect(ev.event_name).toBe("CompraCancelada")
    expect(ev.action_source).toBe("business_messaging")
    expect(ev.messaging_channel).toBe("whatsapp")
    expect(ev.event_id).toBe("cancel-orig-event-123")
    expect(ev.custom_data.order_id).toBe("orig-event-123")
    expect(ev.custom_data.value).toBe(70000)
    expect(ev.user_data.em[0]).toBe(await sha256HexRef("ana@mail.com"))
    expect(ev.user_data.ph[0]).toBe(await sha256HexRef("5491123456789"))
    expect(ev.user_data.country[0]).toBe(await sha256HexRef("ar"))
    expect(JSON.stringify(ev.user_data)).not.toContain("Ana")
  })

  it("no reenvía el mismo evento de cancelación dos veces", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaCancelEvent({ eventId: "e1", value: 50000 })
    await sendMetaCancelEvent({ eventId: "e1", value: 50000 })

    expect(fm.callsTo("graph.facebook.com")).toHaveLength(1)
  })

  it("si Meta falla devuelve ok:false y NO marca como enviado (se puede reintentar)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({ error: "caido" }, 500))

    const r1 = await sendMetaCancelEvent({ eventId: "e2", value: 50000 })
    expect(r1.ok).toBe(false)

    fm.reset()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const r2 = await sendMetaCancelEvent({ eventId: "e2", value: 50000 })
    expect(r2.ok).toBe(true)
    expect(fm.callsTo("graph.facebook.com")).toHaveLength(1)
  })
})
