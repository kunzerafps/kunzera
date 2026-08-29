import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { canResume, clearDraft, loadDraft, saveDraft } from "./storage"
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

beforeEach(() => stubLocalStorage())
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
