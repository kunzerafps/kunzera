import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeGetStore, resetBlobsMock } from "./helpers/blobsMock"

vi.mock("@netlify/blobs", () => ({ getStore: (name: string) => fakeGetStore(name) }))

const { saveAttribution, getAttribution } = await import("../lib/attribution")

// PaymentStep.tsx vuelve a capturar la atribución CADA vez que se entra a la
// pantalla de pago, a propósito, como red de seguridad. Y un borrador se
// puede retomar hasta 24hs después con el MISMO idempotencyKey.
//
// El problema que cubren estos tests: si esa segunda captura llega sin la
// cookie del anuncio (venció, la persona cambió de perfil, o volvió por un
// link directo en vez del aviso), antes pisaba el rastro bueno de la primera
// con vacío. Este blob es el que alimenta la Compra de transferencia y de
// Mercado Pago, o sea la mayoría de las ventas del sitio.
//
// El índice por teléfono (savePhoneAttribution) ya tenía este guard; acá
// faltaba. Ver phone-attribution-bridge.test.ts para el otro lado.
const KEY = "11111111-2222-3333-4444-555555555555"

const PRIMERA = {
  fbc: "fb.1.1700000000000.IwAR-clic-del-anuncio",
  fbp: "fb.1.1700000000000.1234567890",
  ip: "190.10.20.30",
  userAgent: "Mozilla/5.0 (iPhone)",
  city: "Rosario",
  region: "Santa Fe",
  postalCode: "2000",
  countryCode: "AR",
  visitorId: "vid-abc",
  email: "cliente@gmail.com",
  capturedAt: 1700000000000,
}

describe("saveAttribution no pisa un rastro bueno con vacío", () => {
  beforeEach(() => {
    resetBlobsMock()
  })

  it("conserva fbc y email cuando la segunda captura llega sin ellos", async () => {
    await saveAttribution(KEY, PRIMERA)
    await saveAttribution(KEY, { capturedAt: 1700009999999 })

    const guardado = await getAttribution(KEY)
    expect(guardado?.fbc).toBe(PRIMERA.fbc)
    expect(guardado?.email).toBe(PRIMERA.email)
    // Y todo lo demás del rastro del anuncio también.
    expect(guardado?.fbp).toBe(PRIMERA.fbp)
    expect(guardado?.ip).toBe(PRIMERA.ip)
    expect(guardado?.visitorId).toBe(PRIMERA.visitorId)
    expect(guardado?.city).toBe(PRIMERA.city)
    // capturedAt sí es el de la captura nueva.
    expect(guardado?.capturedAt).toBe(1700009999999)
  })

  it("un string vacío tampoco cuenta como dato nuevo", async () => {
    await saveAttribution(KEY, PRIMERA)
    await saveAttribution(KEY, { fbc: "", email: "", capturedAt: 1700009999999 })

    const guardado = await getAttribution(KEY)
    expect(guardado?.fbc).toBe(PRIMERA.fbc)
    expect(guardado?.email).toBe(PRIMERA.email)
  })

  it("lo NUEVO gana cuando sí trae dato (no es un blob congelado)", async () => {
    await saveAttribution(KEY, PRIMERA)
    await saveAttribution(KEY, {
      fbc: "fb.1.1700005555555.IwAR-clic-mas-nuevo",
      email: "otro@gmail.com",
      ip: "200.55.66.77",
      capturedAt: 1700009999999,
    })

    const guardado = await getAttribution(KEY)
    expect(guardado?.fbc).toBe("fb.1.1700005555555.IwAR-clic-mas-nuevo")
    expect(guardado?.email).toBe("otro@gmail.com")
    expect(guardado?.ip).toBe("200.55.66.77")
    // Lo que la segunda no trajo, sobrevive.
    expect(guardado?.visitorId).toBe(PRIMERA.visitorId)
  })

  it("la primera captura se guarda tal cual (sin nada previo que conservar)", async () => {
    await saveAttribution(KEY, { fbp: "fb.1.1.2", capturedAt: 1700000000000 })

    const guardado = await getAttribution(KEY)
    expect(guardado).toEqual({ fbp: "fb.1.1.2", capturedAt: 1700000000000 })
  })

  it("reservas distintas no se mezclan entre sí", async () => {
    await saveAttribution(KEY, PRIMERA)
    await saveAttribution("otra-reserva-9999", { capturedAt: 1700009999999 })

    const otra = await getAttribution("otra-reserva-9999")
    expect(otra?.fbc).toBeUndefined()
    expect(otra?.email).toBeUndefined()
  })
})
