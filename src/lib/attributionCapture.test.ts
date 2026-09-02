import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { captureAttribution } from "./attributionCapture"

// vitest corre en entorno "node": se arman a mano las piezas de navegador que
// tocan las funciones que lee attributionCapture (cookies, localStorage,
// sessionStorage).
function stubBrowser(cookie = "_fbp=fb.1.100.222; _fbc=fb.1.100.AbCd") {
  const local = new Map<string, string>([["kz_vid", "visitante-123"]])
  const session = new Map<string, string>()
  vi.stubGlobal("document", { cookie })
  vi.stubGlobal("window", {})
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (local.has(k) ? local.get(k)! : null),
    setItem: (k: string, v: string) => void local.set(k, v),
    removeItem: (k: string) => void local.delete(k),
  })
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => (session.has(k) ? session.get(k)! : null),
    setItem: (k: string, v: string) => void session.set(k, v),
    removeItem: (k: string) => void session.delete(k),
  })
}

function callArgs(fetchMock: ReturnType<typeof vi.fn>, i: number): [string, RequestInit] {
  return fetchMock.mock.calls[i] as unknown as [string, RequestInit]
}

function lastBody(fetchMock: ReturnType<typeof vi.fn>) {
  const [, init] = callArgs(fetchMock, fetchMock.mock.calls.length - 1)
  return JSON.parse(String(init.body))
}

beforeEach(() => {
  stubBrowser()
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("captureAttribution", () => {
  it("manda el rastro del anuncio con keepalive — sin eso, tocar 'Pagar con Mercado Pago' mata el pedido en vuelo", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const ok = await captureAttribution("pedido-1")

    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = callArgs(fetchMock, 0)
    expect(url).toBe("/api/capture-attribution")
    expect(init.keepalive).toBe(true)
  })

  it("manda las cookies reales de Meta y el id de visitante, nunca inventados", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    await captureAttribution("pedido-2")

    const body = lastBody(fetchMock)
    expect(body.idempotencyKey).toBe("pedido-2")
    expect(body.fbp).toBe("fb.1.100.222")
    expect(body.fbc).toBe("fb.1.100.AbCd")
    expect(body.visitorId).toBe("visitante-123")
  })

  it("si el primer intento falla por red, reintenta una vez más (antes era un solo tiro y mudo)", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const promise = captureAttribution("pedido-3")
    await vi.advanceTimersByTimeAsync(2500)
    const ok = await promise

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(ok).toBe(true)
  })

  it("reintenta también ante un error del servidor (5xx), no solo ante corte de red", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const promise = captureAttribution("pedido-4")
    await vi.advanceTimersByTimeAsync(2500)

    expect(await promise).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("si los dos intentos fallan devuelve false, pero NO tira — la reserva tiene que seguir igual", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network"))
    vi.stubGlobal("fetch", fetchMock)

    const promise = captureAttribution("pedido-5")
    await vi.advanceTimersByTimeAsync(2500)

    expect(await promise).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("sin número de pedido no llama a nada", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    expect(await captureAttribution("")).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sin cookies de Meta manda igual (el resto del rastro sirve), no se inventa ninguna", async () => {
    stubBrowser("") // navegador sin _fbp ni _fbc
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    await captureAttribution("pedido-6")

    const body = lastBody(fetchMock)
    expect(body.fbp).toBeUndefined()
    expect(body.fbc).toBeUndefined()
    expect(body.visitorId).toBe("visitante-123")
  })

  it("sesión interna: NO guarda el rastro — una reserva de prueba no puede terminar en una Compra matcheada contra el equipo", async () => {
    stubBrowser()
    // Dispositivo con la marca de login al panel (lo que setea useAdminGate).
    vi.stubGlobal("window", { location: { hash: "", search: "" } })
    localStorage.setItem("kz_staff", String(Date.now()))
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    expect(await captureAttribution("pedido-de-prueba")).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
