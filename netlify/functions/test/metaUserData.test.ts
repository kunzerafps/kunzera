import { describe, expect, it } from "vitest"
import { sha256Hex, stripAccents, normalizePhoneForHash } from "../lib/metaUserData"

// Cálculo de referencia independiente (no probar la función contra sí misma).
async function sha256HexRef(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest("SHA-256", enc)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

describe("sha256Hex", () => {
  it("devuelve el hash SHA-256 en hex (64 chars) que corresponde", async () => {
    const out = await sha256Hex("5491123456789")
    expect(out).toHaveLength(64)
    expect(out).toBe(await sha256HexRef("5491123456789"))
  })
  it("es sensible a mayúsculas/espacios (el caller normaliza antes)", async () => {
    expect(await sha256Hex("Hola")).not.toBe(await sha256Hex("hola"))
  })
})

describe("stripAccents", () => {
  it("saca tildes manteniendo la letra base", () => {
    expect(stripAccents("maría josé")).toBe("maria jose")
  })
  it("convierte ñ en n", () => {
    expect(stripAccents("nuñez")).toBe("nunez")
  })
  it("no toca texto sin acentos", () => {
    expect(stripAccents("juan perez")).toBe("juan perez")
  })
})

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
  it("saca el '15' pre-unificación dictado en el medio del número", () => {
    expect(normalizePhoneForHash("03382 15-677871")).toBe("5493382677871")
  })
  it("saca el '15' con código de área de 2 dígitos", () => {
    expect(normalizePhoneForHash("011 15 23456789")).toBe("5491123456789")
  })
  it("no toca un número de 10 dígitos limpio aunque contenga '15' de casualidad", () => {
    expect(normalizePhoneForHash("1115556789")).toBe("5491115556789")
  })
})
