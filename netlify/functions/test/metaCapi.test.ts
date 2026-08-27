import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeGetStore, resetBlobsMock } from "./helpers/blobsMock"
import { installFetchMock, jsonResponse } from "./helpers/fetchMock"

vi.mock("@netlify/blobs", () => ({ getStore: (name: string) => fakeGetStore(name) }))

const { sendMetaPurchaseEvent, normalizePhoneForHash } = await import("../lib/metaCapi")

// Implementación de referencia recalculada a mano en el test (mismo
// algoritmo, cálculo independiente) para no "probar contra sí misma" — si
// algún día cambia el hashing en metaCapi.ts sin querer, esto lo detecta.
async function sha256HexNode(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest("SHA-256", enc)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

describe("normalizePhoneForHash", () => {
  it("antepone 549 a un número de 10 dígitos sin código de país", () => {
    expect(normalizePhoneForHash("1123456789")).toBe("5491123456789")
  })
  it("saca el 0 de larga distancia", () => {
    expect(normalizePhoneForHash("01123456789")).toBe("5491123456789")
  })
  it("no duplica el 549 si ya está", () => {
    expect(normalizePhoneForHash("5491123456789")).toBe("5491123456789")
  })
  it("saca el 54 sin el 9 y antepone 549 correctamente", () => {
    expect(normalizePhoneForHash("541123456789")).toBe("5491123456789")
  })
  it("saca el '15' pre-unificación dictado en el medio del número (bug real: rompía el matching)", () => {
    // "3382 15 677871" — código de área 3382 (4 dígitos) + 15 + número local
    expect(normalizePhoneForHash("03382 15-677871")).toBe("5493382677871")
  })
  it("saca el '15' con código de área de 2 dígitos (ej. Buenos Aires, '011 15 ...')", () => {
    // 011 -> 11 (área 2 dígitos) + 15 + 8 dígitos locales
    expect(normalizePhoneForHash("011 15 23456789")).toBe("5491123456789")
  })
  it("no toca un número de 10 dígitos limpio aunque contenga '15' de casualidad", () => {
    // 10 dígitos ya limpios (sin el 15 extra) no deben tocarse por más que
    // aparezca "15" en algún lado del número real.
    expect(normalizePhoneForHash("1115556789")).toBe("5491115556789")
  })
})

describe("sendMetaPurchaseEvent", () => {
  beforeEach(() => {
    resetBlobsMock()
    process.env.META_CAPI_ACCESS_TOKEN = "test-token"
  })

  it("hashea teléfono y nombre con SHA-256 (no manda texto plano)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaPurchaseEvent({
      eventId: "evt-hash-1",
      source: "venta_manual",
      actionSource: "business_messaging",
      value: 50000,
      whatsapp: "01123456789",
      nombre: "Juan Perez",
    })

    const call = fm.callsTo("graph.facebook.com")[0]
    const body = JSON.parse(String(call.init?.body))
    const userData = body.data[0].user_data
    const expectedPhoneHash = await sha256HexNode("5491123456789")
    expect(userData.ph[0]).toBe(expectedPhoneHash)
    expect(userData.ph[0]).not.toContain("1123456789") // no viaja el teléfono en texto plano
    expect(userData.fn[0]).toHaveLength(64) // hash SHA-256 hex
    expect(userData.ln[0]).toHaveLength(64)
  })

  it("saca acentos y ñ del nombre antes de hashear (Meta lo exige; bug real: 'María' se mandaba con tilde)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaPurchaseEvent({
      eventId: "evt-accent-1",
      source: "venta_manual",
      actionSource: "business_messaging",
      value: 50000,
      nombre: "María Núñez",
    })

    const body = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    const userData = body.data[0].user_data
    expect(userData.fn[0]).toBe(await sha256HexNode("maria"))
    expect(userData.ln[0]).toBe(await sha256HexNode("nunez"))
  })

  it("nombre compuesto de 3+ palabras: la última es el apellido, el resto es el nombre (bug real: 'María José Pérez' partía mal)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaPurchaseEvent({
      eventId: "evt-compound-name",
      source: "venta_manual",
      actionSource: "business_messaging",
      value: 50000,
      nombre: "Juan Carlos Pérez",
    })

    const body = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    const userData = body.data[0].user_data
    expect(userData.fn[0]).toBe(await sha256HexNode("juan carlos"))
    expect(userData.ln[0]).toBe(await sha256HexNode("perez"))
  })

  it("nombre de una sola palabra: manda solo fn, sin ln (no inventa apellido)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaPurchaseEvent({
      eventId: "evt-single-name",
      source: "venta_manual",
      actionSource: "business_messaging",
      value: 50000,
      nombre: "Juan",
    })

    const body = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    const userData = body.data[0].user_data
    expect(userData.fn[0]).toBe(await sha256HexNode("juan"))
    expect(userData.ln).toBeUndefined()
  })

  it("manda fbp/fbc/IP/user-agent SIN hashear, tal cual", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaPurchaseEvent({
      eventId: "evt-raw-1",
      source: "mercadopago",
      actionSource: "website",
      value: 70000,
      fbp: "fb.1.1234567890.111",
      fbc: "fb.1.1234567890.IwAR_fake",
      clientIpAddress: "190.190.190.190",
      clientUserAgent: "Mozilla/5.0 TestAgent",
    })

    const call = fm.callsTo("graph.facebook.com")[0]
    const body = JSON.parse(String(call.init?.body))
    const userData = body.data[0].user_data
    expect(userData.fbp).toBe("fb.1.1234567890.111")
    expect(userData.fbc).toBe("fb.1.1234567890.IwAR_fake")
    expect(userData.client_ip_address).toBe("190.190.190.190")
    expect(userData.client_user_agent).toBe("Mozilla/5.0 TestAgent")
  })

  it("no inventa fbc cuando no se lo pasan", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaPurchaseEvent({
      eventId: "evt-no-fbc",
      source: "venta_manual",
      actionSource: "business_messaging",
      value: 50000,
    })

    const call = fm.callsTo("graph.facebook.com")[0]
    const body = JSON.parse(String(call.init?.body))
    expect(body.data[0].user_data.fbc).toBeUndefined()
  })

  it("hashea el external_id (id del navegador) con SHA-256 en user_data.external_id", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaPurchaseEvent({
      eventId: "evt-ext-id",
      source: "mercadopago",
      actionSource: "website",
      value: 70000,
      externalId: "Visitor-XYZ-1",
    })

    const body = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    expect(body.data[0].user_data.external_id[0]).toBe(await sha256HexNode("visitor-xyz-1"))
  })

  it("no manda external_id cuando no se lo pasan", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaPurchaseEvent({
      eventId: "evt-no-ext",
      source: "venta_manual",
      actionSource: "business_messaging",
      value: 50000,
    })

    const body = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    expect(body.data[0].user_data.external_id).toBeUndefined()
  })

  it("hashea el email (em) en minúsculas y sin espacios al borde", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaPurchaseEvent({
      eventId: "evt-email-1",
      source: "venta_manual",
      actionSource: "business_messaging",
      value: 50000,
      email: "  Juan.Perez@GMAIL.com ",
    })

    const body = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    const userData = body.data[0].user_data
    expect(userData.em[0]).toBe(await sha256HexNode("juan.perez@gmail.com"))
    expect(userData.em[0]).not.toContain("gmail") // no viaja en texto plano
  })

  it("no manda em cuando no se pasa email", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaPurchaseEvent({
      eventId: "evt-no-email",
      source: "venta_manual",
      actionSource: "business_messaging",
      value: 50000,
    })

    const body = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    expect(body.data[0].user_data.em).toBeUndefined()
  })

  it("hashea el país (country) cuando se lo pasan", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaPurchaseEvent({
      eventId: "evt-country-1",
      source: "venta_manual",
      actionSource: "business_messaging",
      value: 50000,
      countryCode: "AR",
    })

    const body = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    expect(body.data[0].user_data.country[0]).toBe(await sha256HexNode("ar"))
  })

  it("manda value y currency correctos", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaPurchaseEvent({
      eventId: "evt-value-1",
      source: "mercadopago",
      actionSource: "website",
      value: 70000,
    })

    const body = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    expect(body.data[0].custom_data.value).toBe(70000)
    expect(body.data[0].custom_data.currency).toBe("ARS")
  })

  it("un fallo temporal de Meta permite reintentar (no marca el evento como enviado)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({ error: "temporal" }, 500))

    const first = await sendMetaPurchaseEvent({
      eventId: "evt-retry-1",
      source: "mercadopago",
      actionSource: "website",
      value: 50000,
    })
    expect(first.ok).toBe(false)

    // Reintento (ej. Meta se recupera): al no haberse marcado "enviado", se
    // vuelve a intentar de verdad en vez de devolver éxito falso.
    fm.reset()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const second = await sendMetaPurchaseEvent({
      eventId: "evt-retry-1",
      source: "mercadopago",
      actionSource: "website",
      value: 50000,
    })
    expect(second.ok).toBe(true)
    expect(fm.callsTo("graph.facebook.com")).toHaveLength(1)
  })

  it("un fallo permanente no reintenta en loop dentro del mismo llamado (una sola llamada a Meta por invocación)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({ error: { message: "Invalid token" } }, 401))

    const result = await sendMetaPurchaseEvent({
      eventId: "evt-permanent-fail",
      source: "mercadopago",
      actionSource: "website",
      value: 50000,
    })

    expect(result.ok).toBe(false)
    expect(fm.callsTo("graph.facebook.com")).toHaveLength(1)
  })

  it("una segunda llamada con el mismo eventId no vuelve a pegarle a la API de Meta (idempotencia local)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    const params = {
      eventId: "evt-dup-1",
      source: "transferencia_binance" as const,
      actionSource: "website" as const,
      value: 50000,
    }
    const first = await sendMetaPurchaseEvent(params)
    const second = await sendMetaPurchaseEvent(params) // ej: doble click en "Confirmar pago"

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(fm.callsTo("graph.facebook.com")).toHaveLength(1)
  })

  it("dos ventas distintas (eventId distinto) SÍ generan dos llamadas a Meta", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaPurchaseEvent({
      eventId: "evt-cliente-a",
      source: "venta_manual",
      actionSource: "business_messaging",
      value: 50000,
    })
    await sendMetaPurchaseEvent({
      eventId: "evt-cliente-b",
      source: "venta_manual",
      actionSource: "business_messaging",
      value: 50000,
    })

    expect(fm.callsTo("graph.facebook.com")).toHaveLength(2)
  })

  it("incluye messaging_channel:'whatsapp' cuando action_source es business_messaging (Meta lo exige, error real encontrado en prueba en vivo)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaPurchaseEvent({
      eventId: "evt-messaging-channel",
      source: "venta_manual",
      actionSource: "business_messaging",
      value: 50000,
    })
    await sendMetaPurchaseEvent({
      eventId: "evt-messaging-channel-website",
      source: "mercadopago",
      actionSource: "website",
      value: 50000,
    })

    const calls = fm.callsTo("graph.facebook.com")
    const manualBody = JSON.parse(String(calls[0].init?.body))
    const websiteBody = JSON.parse(String(calls[1].init?.body))
    expect(manualBody.data[0].messaging_channel).toBe("whatsapp")
    expect(websiteBody.data[0].messaging_channel).toBeUndefined()
  })

  it("no filtra teléfono/nombre en los datos que quedan registrados en el log de entrega", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaPurchaseEvent({
      eventId: "evt-privacy-1",
      source: "venta_manual",
      actionSource: "business_messaging",
      value: 50000,
      whatsapp: "1155554444",
      nombre: "Nombre Secreto",
    })

    const { listRecentDeliveries } = await import("../lib/deliveryLog")
    const entries = await listRecentDeliveries(10)
    const entry = entries.find((e) => e.eventId === "evt-privacy-1")
    const serialized = JSON.stringify(entry)
    expect(serialized).not.toContain("1155554444")
    expect(serialized).not.toContain("Nombre Secreto")
  })

  it("incluye event_source_url solo para action_source website, no para business_messaging", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await sendMetaPurchaseEvent({
      eventId: "evt-esurl-website",
      source: "mercadopago",
      actionSource: "website",
      value: 50000,
    })
    await sendMetaPurchaseEvent({
      eventId: "evt-esurl-manual",
      source: "venta_manual",
      actionSource: "business_messaging",
      value: 50000,
    })

    const calls = fm.callsTo("graph.facebook.com")
    const websiteBody = JSON.parse(String(calls[0].init?.body))
    const manualBody = JSON.parse(String(calls[1].init?.body))
    expect(websiteBody.data[0].event_source_url).toBeTruthy()
    expect(manualBody.data[0].event_source_url).toBeUndefined()
  })
})
