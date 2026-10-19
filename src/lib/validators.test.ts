import { describe, expect, it } from "vitest"
import { normalizeEmail, validateEmail, validateWhatsapp, whatsappLinkNumber } from "./validators"

describe("validateWhatsapp — números de otros países", () => {
  it("acepta argentinos y extranjeros con su código de país", () => {
    for (const v of [
      "3382677871",
      "+56 9 1234 5678", // Chile
      "+52 1 55 1234 5678", // México
      "+55 11 91234 5678", // Brasil
      "+57 300 1234567", // Colombia
      "+598 99 123 456", // Uruguay
      "+34 612 34 56 78", // España
    ]) {
      expect(validateWhatsapp(v)).toBeNull()
    }
  })

  it("rechaza más de 15 dígitos", () => {
    expect(validateWhatsapp("1234567890123456")).not.toBeNull()
  })
})

describe("whatsappLinkNumber — link wa.me del panel", () => {
  it("argentinos siguen yendo con 549", () => {
    expect(whatsappLinkNumber("3382677871")).toBe("5493382677871")
    expect(whatsappLinkNumber("5493382677871")).toBe("5493382677871")
    expect(whatsappLinkNumber("03382677871")).toBe("5493382677871")
    expect(whatsappLinkNumber("338215677871")).toBe("5493382677871")
  })

  it("extranjeros van tal cual, sin 549 adelante", () => {
    expect(whatsappLinkNumber("56912345678")).toBe("56912345678")
    expect(whatsappLinkNumber("5215512345678")).toBe("5215512345678")
    expect(whatsappLinkNumber("5511912345678")).toBe("5511912345678")
  })
})

// El mail es OBLIGATORIO (desde 19/10) y su único objetivo es subir la calidad de coincidencia
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

  it("vacío no pasa: el mail es obligatorio", () => {
    expect(validateEmail("")).not.toBeNull()
    expect(validateEmail("   ")).not.toBeNull()
  })

  it("corta los demasiado largos", () => {
    expect(validateEmail("a".repeat(130) + "@gmail.com")).toBe("Demasiado largo")
  })

  it("normaliza a minúsculas y sin espacios, que es como Meta espera el hash", () => {
    expect(normalizeEmail("  Juan@Gmail.COM  ")).toBe("juan@gmail.com")
  })
})
