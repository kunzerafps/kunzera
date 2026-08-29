import { afterEach, describe, expect, it, vi } from "vitest"
import { isStaffSession, trackPixelEvent, trackServerBackedEvent } from "./pixel"

// vitest.config.ts corre en entorno "node" (sin DOM). pixel.ts lee
// window.location.{hash,search}, localStorage, window.fbq, document.cookie y
// fetch — se arma un mínimo a mano, igual que deeplink.test.ts.
function setupWindow(
  opts: { hash?: string; search?: string; staffValue?: string | null } = {},
) {
  const store = new Map<string, string>()
  if (opts.staffValue != null) store.set("kz_staff", opts.staffValue)
  const localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
  const fbq = vi.fn()
  const fetchSpy = vi.fn(() => Promise.resolve(new Response("{}")))
  vi.stubGlobal("window", {
    location: {
      hash: opts.hash ?? "",
      search: opts.search ?? "",
      pathname: "/",
      href: "https://kunzera.com/",
    },
    localStorage,
    fbq,
    __kunzeraVid: "vid-test",
  })
  vi.stubGlobal("localStorage", localStorage)
  vi.stubGlobal("document", { cookie: "" })
  vi.stubGlobal("fetch", fetchSpy)
  return { fbq, fetchSpy, store }
}

const RECENT = () => String(Date.now())
const OLD = () => String(Date.now() - 100 * 24 * 60 * 60 * 1000) // 100 días → vencido

afterEach(() => vi.unstubAllGlobals())

describe("isStaffSession (G1)", () => {
  it("false en una visita normal", () => {
    setupWindow()
    expect(isStaffSession()).toBe(false)
  })

  it("true cuando la URL tiene #admin (se está abriendo el panel)", () => {
    setupWindow({ hash: "#admin" })
    expect(isStaffSession()).toBe(true)
  })

  it("true con kz_staff = timestamp reciente", () => {
    setupWindow({ staffValue: RECENT() })
    expect(isStaffSession()).toBe(true)
  })

  it("false con kz_staff = timestamp vencido (>90 días)", () => {
    setupWindow({ staffValue: OLD() })
    expect(isStaffSession()).toBe(false)
  })

  it("true con el valor viejo 'kz_staff' = '1' (compat pre-timestamp)", () => {
    setupWindow({ staffValue: "1" })
    expect(isStaffSession()).toBe(true)
  })

  it("?kz_track=1 borra la marca y devuelve false aunque sea reciente", () => {
    const { store } = setupWindow({ search: "?kz_track=1", staffValue: RECENT() })
    expect(isStaffSession()).toBe(false)
    expect(store.has("kz_staff")).toBe(false) // la escotilla limpió el flag
  })

  it("no rompe si localStorage tira excepción (modo privado)", () => {
    const throwingLs = {
      getItem: () => {
        throw new Error("blocked")
      },
    }
    vi.stubGlobal("window", { location: { hash: "", search: "" }, localStorage: throwingLs })
    vi.stubGlobal("localStorage", throwingLs)
    expect(isStaffSession()).toBe(false)
  })
})

describe("trackPixelEvent respeta isStaffSession (G1)", () => {
  it("visita normal: llama a fbq", () => {
    const { fbq } = setupWindow()
    trackPixelEvent("Lead", { value: 1 })
    expect(fbq).toHaveBeenCalledWith("track", "Lead", { value: 1 })
  })

  it("sesión de staff (#admin): NO llama a fbq", () => {
    const { fbq } = setupWindow({ hash: "#admin" })
    trackPixelEvent("Lead", { value: 1 })
    expect(fbq).not.toHaveBeenCalled()
  })

  it("dispositivo del equipo (kz_staff reciente): NO llama a fbq", () => {
    const { fbq } = setupWindow({ staffValue: RECENT() })
    trackPixelEvent("Purchase", {})
    expect(fbq).not.toHaveBeenCalled()
  })
})

describe("trackServerBackedEvent respeta isStaffSession (G1)", () => {
  it("visita normal: hace el POST a /api/capi-funnel", () => {
    const { fetchSpy } = setupWindow()
    trackServerBackedEvent("Lead", { whatsapp: "1155554444" }, { value: 50000 })
    expect(fetchSpy).toHaveBeenCalledWith("/api/capi-funnel", expect.objectContaining({ method: "POST" }))
  })

  it("sesión de staff por #admin: no dispara el píxel ni el POST server-side", () => {
    const { fbq, fetchSpy } = setupWindow({ hash: "#admin" })
    trackServerBackedEvent("Lead", { whatsapp: "1155554444" }, { value: 50000 })
    expect(fbq).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("sesión de staff por kz_staff: no dispara el píxel ni el POST server-side", () => {
    const { fbq, fetchSpy } = setupWindow({ staffValue: RECENT() })
    trackServerBackedEvent("Lead", { whatsapp: "1155554444" }, { value: 50000 })
    expect(fbq).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
