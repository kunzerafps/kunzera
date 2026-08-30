import { describe, expect, it } from "vitest"
import { normalizeEmail, validateEmail } from "./validators"

// El mail es OPCIONAL y su único objetivo es subir la calidad de coincidencia
// de Meta (llegaba solo en el 40% de las compras). La validación tiene que
// ser laxa a propósito: rebotar a alguien en la mitad de una compra por un
// mail raro pero válido cuesta MUCHO más que el dato que se gana.
describe("validateEmail", () => {
  it("acepta mails normales", () => {
    for (const v of ["juan@gmail.com", "ana.perez@hotmail.com.ar", "x+etiqueta@dominio.io"]) {
      expect(validateEmail(v)).toBeNull()
    }
  })

  it("acepta mails con formas raras pero válidas — no queremos rebotar compradores reales", () => {
    for (const v of ["nombre_apellido@sub.dominio.com.ar", "a@b.co", "JUAN@GMAIL.COM"]) {
      expect(validateEmail(v)).toBeNull()
    }
  })

  it("rechaza lo que claramente no es un mail", () => {
    for (const v of ["juan", "juan@", "@gmail.com", "juan gmail.com", "juan@gmail"]) {
      expect(validateEmail(v)).not.toBeNull()
    }
  })

  it("vacío no reta: apunta al botón de saltear", () => {
    expect(validateEmail("")).toContain("Prefiero no dejarlo")
    expect(validateEmail("   ")).toContain("Prefiero no dejarlo")
  })

  it("corta los demasiado largos", () => {
    expect(validateEmail("a".repeat(130) + "@gmail.com")).toBe("Demasiado largo")
  })

  it("normaliza a minúsculas y sin espacios, que es como Meta espera el hash", () => {
    expect(normalizeEmail("  Juan@Gmail.COM  ")).toBe("juan@gmail.com")
  })
})
