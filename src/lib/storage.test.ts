import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  addToCartFiredForPack,
  canResume,
  clearDraft,
  clearFiredOnceInSession,
  firedOnceInSession,
  loadDraft,
  markAddToCartFiredForPack,
  markFiredOnceInSession,
  saveDraft,
} from "./storage"
import type { OrderDraft } from "../types/order"

// vitest corre en entorno "node" — se arma un localStorage mínimo a mano.
function stubLocalStorage() {
  const map = new Map<string, string>()
  const ls = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
  vi.stubGlobal("localStorage", ls)
  return map
}

// Los guards de eventos ("ya mandé AddToCart") viven en sessionStorage, no en
// localStorage: tienen que morir cuando se cierra la pestaña.
function stubSessionStorage() {
  const map = new Map<string, string>()
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  })
  return map
}

beforeEach(() => {
  stubLocalStorage()
  stubSessionStorage()
})
afterEach(() => vi.unstubAllGlobals())

const draft: OrderDraft = { pack: "platino", monto: 50000 }

describe("canResume", () => {
  it("acepta los estados con datos que valen la pena retomar", () => {
    for (const s of ["planPicked", "askName", "askWhatsapp", "pickSlot", "review", "payment", "uploadProof"] as const) {
      expect(canResume(s)).toBe(true)
    }
  })

  it("NO acepta 'askDiscord' (paso eliminado) ni estados no-retomables", () => {
    expect(canResume("askDiscord")).toBe(false)
    expect(canResume("idle")).toBe(false)
    expect(canResume("greeting")).toBe(false)
    expect(canResume("confirmed")).toBe(false)
    expect(canResume("error")).toBe(false)
  })
})

describe("loadDraft", () => {
  it("guarda y recupera un draft en un estado retomable", () => {
    saveDraft(draft, "planPicked")
    const got = loadDraft()
    expect(got?.state).toBe("planPicked")
    expect(got?.draft.pack).toBe("platino")
  })

  it("descarta un draft viejo en un estado que ya no se puede retomar ('askDiscord')", () => {
    // simula un draft persistido por una versión anterior
    localStorage.setItem(
      "kz_order_draft_v1",
      JSON.stringify({ draft, state: "askDiscord", savedAt: Date.now() }),
    )
    expect(loadDraft()).toBeNull() // no ofrece un "Retomar" muerto
    expect(localStorage.getItem("kz_order_draft_v1")).toBeNull() // y lo limpió
  })

  it("descarta un draft vencido (>24h)", () => {
    localStorage.setItem(
      "kz_order_draft_v1",
      JSON.stringify({ draft, state: "planPicked", savedAt: Date.now() - 25 * 3600 * 1000 }),
    )
    expect(loadDraft()).toBeNull()
  })

  it("saveDraft en un estado no-retomable limpia el draft en vez de guardarlo", () => {
    saveDraft(draft, "planPicked")
    expect(loadDraft()).not.toBeNull()
    saveDraft(draft, "greeting")
    expect(loadDraft()).toBeNull()
  })

  it("clearDraft borra", () => {
    saveDraft(draft, "askName")
    clearDraft()
    expect(loadDraft()).toBeNull()
  })
})

// El guard de AddToCart guarda QUÉ pack se mandó, no un booleano. Si la
// persona compara los dos packs y termina cambiando, Meta tiene que recibir
// el evento con el pack y el precio de la venta real, no con los del primero
// que miró.
describe("guard de AddToCart por pack", () => {
  it("arranca sin nada disparado", () => {
    expect(addToCartFiredForPack()).toBeNull()
  })

  it("recuerda el pack que se mandó", () => {
    markAddToCartFiredForPack("platino")
    expect(addToCartFiredForPack()).toBe("platino")
  })

  it("elegir el MISMO pack de nuevo no lo vuelve a contar", () => {
    markAddToCartFiredForPack("diamante")
    expect(addToCartFiredForPack()).toBe("diamante") // el caller compara y no re-dispara
  })

  it("cambiar de pack sí tiene que volver a mandarlo, con el pack nuevo", () => {
    markAddToCartFiredForPack("platino")
    expect(addToCartFiredForPack()).not.toBe("diamante") // el caller ve que difiere → re-dispara
    markAddToCartFiredForPack("diamante")
    expect(addToCartFiredForPack()).toBe("diamante")
  })

  it("se limpia al confirmar una reserva, para que otra compra en la misma sesión vuelva a contar", () => {
    markAddToCartFiredForPack("platino")
    markFiredOnceInSession("lead")
    clearFiredOnceInSession()
    expect(addToCartFiredForPack()).toBeNull()
    expect(firedOnceInSession("lead")).toBe(false)
  })
})

// Estos dos se contaban de más y le inflaban a Meta el volumen de eventos.
describe("topes de ViewContent y Contact", () => {
  it("'vio los precios' se cuenta una vez por VISITA, no una por carga de página", () => {
    // El guard viejo era el viewport once:true de framer-motion, que es por
    // montaje del componente: cada recarga sumaba otro ViewContent.
    expect(firedOnceInSession("viewContent")).toBe(false)
    markFiredOnceInSession("viewContent")
    expect(firedOnceInSession("viewContent")).toBe(true)
  })

  it("'tocó WhatsApp' tiene UN tope compartido por los 4 botones", () => {
    // Antes cada botón contaba por su lado: abrir el chat + flotante + pie de
    // página + link de recuperación = 4 Contact de la misma persona.
    expect(firedOnceInSession("contact")).toBe(false)
    markFiredOnceInSession("contact") // p. ej. el flotante
    expect(firedOnceInSession("contact")).toBe(true) // el del pie ya no cuenta
  })

  it("los dos sobreviven a que el chat se desmonte (viven en sessionStorage, no en un ref)", () => {
    markFiredOnceInSession("viewContent")
    markFiredOnceInSession("contact")
    // Un ref de React se reiniciaría acá; sessionStorage no.
    expect(sessionStorage.getItem("kz_viewcontent_fired")).toBe("1")
    expect(sessionStorage.getItem("kz_contact_fired")).toBe("1")
  })

  it("se limpian al confirmar una reserva, junto con el resto", () => {
    markFiredOnceInSession("viewContent")
    markFiredOnceInSession("contact")
    clearFiredOnceInSession()
    expect(firedOnceInSession("viewContent")).toBe(false)
    expect(firedOnceInSession("contact")).toBe(false)
  })
})
