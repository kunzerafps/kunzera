import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeGetStore, resetBlobsMock } from "./helpers/blobsMock"
import { installFetchMock, jsonResponse } from "./helpers/fetchMock"

vi.mock("@netlify/blobs", () => ({ getStore: (name: string) => fakeGetStore(name) }))

const { sendMetaPageViewEvent } = await import("../lib/metaCapiPageView")

describe("sendMetaPageViewEvent", () => {
  beforeEach(() => {
    resetBlobsMock()
    process.env.META_CAPI_ACCESS_TOKEN = "test-token"
  })

  it("manda event_name PageView con action_source website", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaPageViewEvent({ eventId: "pv-1" })

    const call = fm.callsTo("graph.facebook.com")[0]
    const body = JSON.parse(String(call.init?.body))
    expect(body.data[0].event_name).toBe("PageView")
    expect(body.data[0].action_source).toBe("website")
    expect(body.data[0].event_id).toBe("pv-1")
  })

  it("manda fbp/fbc/ip/user-agent sin hashear (no son PII de identidad)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaPageViewEvent({
      eventId: "pv-2",
      fbp: "fb.1.111.222",
      fbc: "fb.1.111.IwAR_real",
      clientIpAddress: "201.201.201.201",
      clientUserAgent: "Mozilla/5.0 Visitante",
    })

    const call = fm.callsTo("graph.facebook.com")[0]
    const body = JSON.parse(String(call.init?.body))
    expect(body.data[0].user_data).toEqual({
      fbp: "fb.1.111.222",
      fbc: "fb.1.111.IwAR_real",
      client_ip_address: "201.201.201.201",
      client_user_agent: "Mozilla/5.0 Visitante",
    })
  })

  it("hashea el external_id con SHA-256 (no viaja el id del navegador en texto plano)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaPageViewEvent({ eventId: "pv-ext", externalId: "ABC-vid-123" })

    async function ref(input: string) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("")
    }
    const body = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    expect(body.data[0].user_data.external_id).toBe(await ref("abc-vid-123"))
  })

  it("hashea la geo (ciudad/provincia/postal/país) como ct/st/zp/country con la misma normalización que Purchase", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaPageViewEvent({
      eventId: "pv-geo",
      city: "San Nicolás",
      region: "Buenos Aires",
      postalCode: "B2900",
      countryCode: "AR",
    })

    async function ref(input: string) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("")
    }
    const userData = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0].user_data
    expect(userData.ct).toBe(await ref("sannicolas")) // sin acento, minúscula, sin espacios
    expect(userData.st).toBe(await ref("buenosaires"))
    expect(userData.zp).toBe(await ref("b2900"))
    expect(userData.country).toBe(await ref("ar"))
  })

  it("no manda user_data vacío de más cuando no hay fbp/fbc", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaPageViewEvent({ eventId: "pv-3" })

    const call = fm.callsTo("graph.facebook.com")[0]
    const body = JSON.parse(String(call.init?.body))
    expect(body.data[0].user_data).toEqual({})
  })

  it("no reenvía el mismo eventId dos veces (dedup local)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaPageViewEvent({ eventId: "pv-4" })
    await sendMetaPageViewEvent({ eventId: "pv-4" })

    expect(fm.callsTo("graph.facebook.com").length).toBe(1)
  })

  it("usa un store de deduplicación separado del de Purchase", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaPageViewEvent({ eventId: "evt-compartido" })

    // Si compartiera store con metaCapi.ts, una Compra con el mismo
    // event_id (coincidencia rara pero posible si algún día se reusa un id)
    // se frenaría por error. Se verifica leyendo el store específico de
    // PageView directamente.
    const marked = await fakeGetStore("capi-pageview-events-sent").get("evt-compartido")
    expect(marked).not.toBeNull()
    const purchaseStoreMarked = await fakeGetStore("capi-events-sent").get("evt-compartido")
    expect(purchaseStoreMarked).toBeNull()
  })

  it("sin token configurado, no llama a Meta y devuelve error", async () => {
    delete process.env.META_CAPI_ACCESS_TOKEN
    const fm = installFetchMock()

    const result = await sendMetaPageViewEvent({ eventId: "pv-5" })

    expect(result.ok).toBe(false)
    expect(fm.calls.length).toBe(0)
  })

  it("un fallo de Meta (ej. token vencido) no marca el evento como enviado, permite reintentar", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({ error: { message: "Invalid token" } }, 401))

    const first = await sendMetaPageViewEvent({ eventId: "pv-retry-1" })
    expect(first.ok).toBe(false)

    const marked = await fakeGetStore("capi-pageview-events-sent").get("pv-retry-1")
    expect(marked).toBeNull()

    fm.reset()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const second = await sendMetaPageViewEvent({ eventId: "pv-retry-1" })
    expect(second.ok).toBe(true)
  })

  it("un fallo de red (fetch rechaza) se maneja sin tirar, devuelve error", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => {
      throw new Error("network down")
    })

    const result = await sendMetaPageViewEvent({ eventId: "pv-6" })

    expect(result.ok).toBe(false)
    const marked = await fakeGetStore("capi-pageview-events-sent").get("pv-6")
    expect(marked).toBeNull()
  })
})
