import { describe, expect, it } from "vitest"
import { sha256Hex, stripAccents, normalizePhoneForHash, normalizePhoneForMeta } from "../lib/metaUserData"

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

// normalizePhoneForMeta es la que arma el `ph` que viaja a Meta.
// normalizePhoneForHash (arriba) sigue armando CLAVES y está congelada a
// propósito: cambiarla haría que una venta manual ya cargada calcule otro
// event_id y Meta la pueda contar dos veces.
describe("normalizePhoneForMeta", () => {
  // Lo primero y más importante: para un número argentino bien formado las
  // dos funciones tienen que dar EXACTAMENTE lo mismo. Si esto se rompe,
  // se partió el matching de todos los eventos.
  describe("no cambia nada para los números argentinos de siempre", () => {
    for (const entrada of [
      "1123456789",
      "01123456789",
      "5491123456789",
      "541123456789",
      "03382 15-677871",
      "011 15 23456789",
      "1115556789",
    ]) {
      it(`"${entrada}" da lo mismo que normalizePhoneForHash`, () => {
        expect(normalizePhoneForMeta(entrada)).toBe(normalizePhoneForHash(entrada))
      })
    }
  })

  // (b) Antes: "005491123456789" no entraba por la rama del código de país
  // (empieza con "005"), caía en la del "0" de larga distancia y terminaba
  // en "54905491123456789" — 17 dígitos, un teléfono que no existe.
  describe("prefijo internacional a la vieja usanza (00)", () => {
    it("lee 0054 9 11 ... como el número argentino que es", () => {
      expect(normalizePhoneForMeta("0054 9 11 2345-6789")).toBe("5491123456789")
    })
    it("la función vieja lo deformaba (queda documentado el porqué del cambio)", () => {
      expect(normalizePhoneForHash("0054 9 11 2345-6789")).not.toBe("5491123456789")
    })
  })

  // (a) Antes se le anteponía "549" a cualquier cosa: un chileno quedaba
  // como "54956912345678" y no coincidía con nadie.
  describe("números de otros países", () => {
    it("deja el número chileno tal cual, en formato internacional", () => {
      expect(normalizePhoneForMeta("+56 9 1234 5678")).toBe("56912345678")
    })
    it("deja el número uruguayo tal cual", () => {
      expect(normalizePhoneForMeta("+598 99 123 456")).toBe("59899123456")
    })
    it("no lo disfraza de argentino aunque quede en 10 dígitos tras sacar un '15'", () => {
      // "521551523456": el barrido del "15" lo dejaba en 10 dígitos y salía
      // como "5495251523456". El código de área resultante empezaba con 5, y
      // en Argentina todos empiezan con 1, 2 o 3.
      expect(normalizePhoneForMeta("521551523456")).toBe("521551523456")
    })
  })

  // (c) Antes cualquier basura producía "549" + lo que hubiera: un hash con
  // forma válida que Meta contaba como dato provisto y no coincidía jamás.
  describe("basura o número incompleto: mejor no mandar nada", () => {
    for (const entrada of ["", "   ", "-", "12", "45678901", "0"]) {
      it(`"${entrada}" devuelve undefined`, () => {
        expect(normalizePhoneForMeta(entrada)).toBeUndefined()
      })
    }
    it("la función vieja devolvía un hash con forma válida para un espacio", () => {
      expect(normalizePhoneForHash(" ")).toBe("549")
    })
  })
})
