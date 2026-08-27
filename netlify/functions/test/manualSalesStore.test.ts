import { describe, expect, it, vi } from "vitest"
import { fakeGetStore } from "./helpers/blobsMock"

vi.mock("@netlify/blobs", () => ({ getStore: (name: string) => fakeGetStore(name) }))

const { generateManualSaleId } = await import("../lib/manualSalesStore")

describe("generateManualSaleId", () => {
  it("arma KZM-AAMMDD-XXXX a partir de la fecha de la venta", () => {
    // rand fijo en 0 -> siempre el primer caracter del alfabeto ("A")
    expect(generateManualSaleId("2026-08-27", () => 0)).toBe("KZM-260827-AAAA")
    expect(generateManualSaleId("2026-12-05", () => 0)).toBe("KZM-261205-AAAA")
  })

  it("el sufijo son 4 caracteres del alfabeto sin ambigüedades (sin 0/O/1/I/L)", () => {
    const ids = Array.from({ length: 400 }, () => generateManualSaleId("2026-08-27"))
    for (const id of ids) {
      const suffix = id.split("-")[2]
      expect(suffix).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/)
    }
    // con 400 tiradas es prácticamente imposible que salga siempre el mismo
    expect(new Set(ids).size).toBeGreaterThan(1)
  })

  it("mismo prefijo de fecha para la misma fecha, sin importar el sufijo", () => {
    const a = generateManualSaleId("2026-08-27")
    const b = generateManualSaleId("2026-08-27")
    expect(a.slice(0, 10)).toBe("KZM-260827")
    expect(b.slice(0, 10)).toBe("KZM-260827")
  })
})
