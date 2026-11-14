import { describe, expect, it } from "vitest"
import { detectPayload, initialContext, reduce } from "./chatFlow"
import type { FlowContext } from "./chatFlow"
import type { FlowEvent } from "../types/order"
import { mpTotal, MP_FEE_RATE } from "./pricing"
import { PACKS } from "./packs"
import {
  armadoDeadline,
  armadoResumen,
  bumpArmadoTurno,
  enviarArmadoConReintento,
  prepararArmado,
} from "./armado"
import { generateSlots, normalizeIso } from "./slots"
import { canResume } from "./storage"

function run(events: FlowEvent[], start: FlowContext = initialContext()): FlowContext {
  return events.reduce((ctx, ev) => reduce(ctx, ev), start)
}

// Elige el pack y deja nombre, WhatsApp y mail: queda en la primera pregunta.
const HASTA_EL_CUESTIONARIO: FlowEvent[] = [
  { type: "OPEN" },
  { type: "SELECT_CHIP", payload: "armado", label: "Quiero Armado de PC" },
  { type: "SELECT_CHIP", payload: "reservar", label: "Sí, empezar" },
  { type: "SET_NAME", value: "Lucas Ferreyra" },
  { type: "SET_WHATSAPP", value: "1155550142" },
  { type: "SET_EMAIL", value: "lucas@example.com" },
]

describe("Armado de PC: precio", () => {
  it("sale $30.000 y por Mercado Pago quedan al menos $30.000 netos", () => {
    expect(PACKS.armado.price).toBe(30000)
    const total = mpTotal(PACKS.armado.price)
    expect(total % 1000).toBe(0)
    expect(total * (1 - MP_FEE_RATE)).toBeGreaterThanOrEqual(30000)
  })
})

describe("Armado de PC: chat", () => {
  it("el texto libre lo elige sin pisar a los otros packs", () => {
    expect(detectPayload("quiero armar una pc")).toBe("armado")
    expect(detectPayload("me decís qué comprar?")).toBe("armado")
    expect(detectPayload("quiero el diamante")).toBe("diamante")
    expect(detectPayload("cuánto sale")).toBe("packs")
    expect(detectPayload("tengo una notebook")).toBe("notebooks")
  })

  it("después del mail va al cuestionario, no al selector de turnos", () => {
    const ctx = run(HASTA_EL_CUESTIONARIO)
    expect(ctx.state).toBe("armadoTipo")
    expect(ctx.draft.pack).toBe("armado")
    expect(ctx.draft.monto).toBe(30000)
  })

  it("los otros packs siguen yendo al selector de turnos", () => {
    const ctx = run([
      { type: "OPEN" },
      { type: "SELECT_CHIP", payload: "platino", label: "Quiero Platino" },
      { type: "SELECT_CHIP", payload: "reservar", label: "Sí, reservar" },
      { type: "SET_NAME", value: "Lucas Ferreyra" },
      { type: "SET_WHATSAPP", value: "1155550142" },
      { type: "SET_EMAIL", value: "lucas@example.com" },
    ])
    expect(ctx.state).toBe("pickSlot")
  })

  it("armar de cero saltea la pregunta de la PC actual", () => {
    const ctx = run([
      ...HASTA_EL_CUESTIONARIO,
      { type: "SELECT_CHIP", payload: "armado_cero", label: "Armar de cero" },
      { type: "ARMADO_ANSWER", value: "$1.500.000" },
    ])
    expect(ctx.state).toBe("armadoUso")
  })

  it("mejorar la PC pregunta qué PC tiene", () => {
    const ctx = run([
      ...HASTA_EL_CUESTIONARIO,
      { type: "SELECT_CHIP", payload: "armado_mejora", label: "Mejorar la que tengo" },
      { type: "ARMADO_ANSWER", value: "$600.000" },
    ])
    expect(ctx.state).toBe("armadoPcActual")
  })

  it("recorrido completo: llega al resumen con el pedido listo para la planilla", () => {
    const ctx = run([
      ...HASTA_EL_CUESTIONARIO,
      { type: "SELECT_CHIP", payload: "armado_mejora", label: "Mejorar la que tengo" },
      { type: "ARMADO_ANSWER", value: "$600.000" },
      { type: "ARMADO_ANSWER", value: "Ryzen 5 3600, GTX 1660, 16 GB" },
      { type: "ARMADO_ANSWER", value: "CS2 a 240 FPS en 1080p" },
      { type: "SELECT_CHIP", payload: "armado_si", label: "Sí" },
    ])
    expect(ctx.state).toBe("review")
    // La planilla exige turno y discord: tienen que estar los dos.
    expect(ctx.draft.turno).toBeTruthy()
    expect(ctx.draft.discord).toBe(
      "ARMADO · Mejorar la PC que tiene · Presupuesto: $600.000 · PC actual: Ryzen 5 3600, GTX 1660, 16 GB · Uso: CS2 a 240 FPS en 1080p · Seguir mejorándola: sí",
    )
    const resumen = ctx.messages[ctx.messages.length - 1].text
    expect(resumen).toContain("24 a 48 hs")
    expect(resumen).toContain("sin ajustes")
    // Nada de lo que es propio de una optimización con turno.
    expect(resumen).not.toContain("turno")
    expect(resumen).not.toContain("soporte")
  })

  it("el '¡Listo!' no habla de turno, AnyDesk ni soporte", () => {
    const ctx = run([
      ...HASTA_EL_CUESTIONARIO,
      { type: "SELECT_CHIP", payload: "armado_cero", label: "Armar de cero" },
      { type: "ARMADO_ANSWER", value: "$1.500.000" },
      { type: "ARMADO_ANSWER", value: "Valorant y edición" },
      { type: "SELECT_CHIP", payload: "armado_no", label: "No, que quede así" },
      { type: "CONFIRM_REVIEW" },
      { type: "CONFIRM_PAYMENT" },
      { type: "UPLOAD_FILE", file: { base64: "x", mime: "image/png", name: "c.png", size: 1 } },
      { type: "SUBMIT_OK", fileUrl: "" },
    ])
    expect(ctx.state).toBe("confirmed")
    const listo = ctx.messages[ctx.messages.length - 1].text
    expect(listo).toContain("24 a 48 hs")
    expect(listo).not.toContain("turno")
    expect(listo).not.toContain("AnyDesk")
    expect(listo).not.toContain("soporte")
  })

  it("volver de Mercado Pago sin el pedido guardado muestra el '¡Listo!' del armado", () => {
    const ctx = reduce(initialContext(), {
      type: "MP_RETURN",
      status: "success",
      draft: { turno: armadoDeadline(), idempotencyKey: "abc12345", pack: "armado" },
    })
    expect(ctx.state).toBe("confirmed")
    expect(ctx.messages[0].text).toContain("Armado de PC")
    expect(ctx.messages[0].text).not.toContain("AnyDesk")
  })

  it("'Cambiar' en el resumen vuelve a la última pregunta, no al selector de turnos", () => {
    const ctx = run([
      ...HASTA_EL_CUESTIONARIO,
      { type: "SELECT_CHIP", payload: "armado_cero", label: "Armar de cero" },
      { type: "ARMADO_ANSWER", value: "$1.500.000" },
      { type: "ARMADO_ANSWER", value: "Valorant" },
      { type: "SELECT_CHIP", payload: "armado_si", label: "Sí" },
      { type: "BACK" },
    ])
    expect(ctx.state).toBe("armadoFuturo")
  })

  it("un 'slot_taken' que igual llegue no lo manda a elegir horario", () => {
    const ctx = run([
      ...HASTA_EL_CUESTIONARIO,
      { type: "SELECT_CHIP", payload: "armado_cero", label: "Armar de cero" },
      { type: "ARMADO_ANSWER", value: "$1.500.000" },
      { type: "ARMADO_ANSWER", value: "Valorant" },
      { type: "SELECT_CHIP", payload: "armado_si", label: "Sí" },
      { type: "CONFIRM_REVIEW" },
      { type: "CONFIRM_PAYMENT" },
      { type: "UPLOAD_FILE", file: { base64: "x", mime: "image/png", name: "c.png", size: 1 } },
      { type: "SUBMIT_ERR", error: "slot_taken" },
    ])
    expect(ctx.state).toBe("error")
  })

  it("las preguntas se pueden retomar si cierra la página", () => {
    for (const s of ["armadoTipo", "armadoPresupuesto", "armadoPcActual", "armadoUso", "armadoFuturo"] as const) {
      expect(canResume(s)).toBe(true)
    }
  })
})

describe("Armado de PC: fecha límite que viaja como 'turno'", () => {
  it("es 48 hs después de la compra (con hasta 1 minuto de corrimiento)", () => {
    const now = new Date("2026-11-13T18:03:27.000Z")
    const ms = new Date(armadoDeadline(now)).getTime() - now.getTime()
    expect(ms).toBeGreaterThan(48 * 3600 * 1000 - 60 * 1000)
    expect(ms).toBeLessThanOrEqual(48 * 3600 * 1000 + 60 * 1000)
  })

  it("nunca cae en un minuto múltiplo de 5", () => {
    const base = new Date("2026-11-13T17:00:00.000Z").getTime()
    for (let m = 0; m < 180; m++) {
      const iso = armadoDeadline(new Date(base + m * 60 * 1000))
      expect(new Date(iso).getUTCMinutes() % 5).not.toBe(0)
      expect(new Date(iso).getUTCSeconds()).toBe(0)
    }
  })

  it("no coincide con ningún turno real de optimización", () => {
    const now = new Date("2026-11-13T15:00:00.000Z")
    const reales = new Set(generateSlots([], now).map((s) => normalizeIso(s.iso)))
    expect(reales.size).toBeGreaterThan(0)
    for (let m = 0; m < 24 * 60; m += 7) {
      expect(reales.has(armadoDeadline(new Date(now.getTime() + m * 60 * 1000)))).toBe(false)
    }
  })

  it("el minuto siguiente también queda fuera de los turnos", () => {
    const iso = bumpArmadoTurno("2026-11-15T18:04:00.000Z")
    expect(iso).toBe("2026-11-15T18:06:00.000Z")
  })

  it("al mandar, la fecha se cuenta desde ese momento y no toca otros packs", () => {
    const now = new Date("2026-11-13T18:03:00.000Z")
    const armado = prepararArmado(
      { pack: "armado", turno: "2026-01-01T00:01:00.000Z", armadoTipo: "cero", armadoPresupuesto: "$1.000.000", armadoUso: "CS2" },
      now,
    )
    expect(armado.turno).toBe(armadoDeadline(now))
    expect(armado.discord).toContain("ARMADO · De cero")
    const platino = { pack: "platino" as const, turno: "2026-11-20T17:00:00.000Z", discord: "-" }
    expect(prepararArmado(platino, now)).toBe(platino)
  })
})

describe("Armado de PC: respuestas en el campo discord", () => {
  it("empieza con ARMADO, va en una línea y corta lo que sea larguísimo", () => {
    const r = armadoResumen({
      armadoTipo: "cero",
      armadoPresupuesto: "=1+1\n$900.000",
      armadoUso: "x".repeat(900),
      armadoFuturo: "no",
    })
    expect(r.startsWith("ARMADO · ")).toBe(true)
    expect(r).not.toContain("\n")
    expect(r.length).toBeLessThan(450)
    expect(r).toContain("Seguir mejorándola: no")
  })

  it("un @everyone del cliente no puede pingear el Discord", () => {
    const r = armadoResumen({ armadoTipo: "cero", armadoPresupuesto: "1", armadoUso: "@everyone" })
    expect(r).not.toContain("@everyone")
  })
})

describe("Armado de PC: reintento si el minuto ya está tomado", () => {
  it("prueba con el minuto siguiente hasta que entra", async () => {
    const usados: string[] = []
    const res = await enviarArmadoConReintento("2026-11-15T18:03:00.000Z", async (turno) => {
      usados.push(turno)
      return usados.length < 3 ? { ok: false, error: "slot_taken" } : { ok: true }
    })
    expect(res.ok).toBe(true)
    expect(usados).toEqual([
      "2026-11-15T18:03:00.000Z",
      "2026-11-15T18:04:00.000Z",
      "2026-11-15T18:06:00.000Z",
    ])
  })

  it("no reintenta ante otros errores", async () => {
    let n = 0
    const res = await enviarArmadoConReintento("2026-11-15T18:03:00.000Z", async () => {
      n++
      return { ok: false, error: "network" }
    })
    expect(res.ok).toBe(false)
    expect(n).toBe(1)
  })
})
