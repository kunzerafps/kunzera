import { describe, expect, it } from "vitest"
import { generateSlots } from "./slots"

// Lunes 30/11/2026 a las 08:00 AR: la semana entera queda por delante.
const NOW = new Date("2026-11-30T08:00:00-03:00")

function hoursOf(dayKey: string): string[] {
  return generateSlots([], NOW)
    .filter((s) => s.dayKey === dayKey)
    .map((s) => s.hour)
}

describe("generateSlots — horario por día", () => {
  it("lunes, miércoles y viernes terminan a las 19:20 (sin 19:40)", () => {
    for (const day of ["2026-11-30", "2026-12-02", "2026-12-04"]) {
      const hours = hoursOf(day)
      expect(hours[0]).toBe("14:00")
      expect(hours[hours.length - 1]).toBe("19:20")
      expect(hours).not.toContain("19:40")
      expect(hours).toHaveLength(17)
    }
  })

  it("martes, jueves y sábado mantienen el de 19:40", () => {
    for (const day of ["2026-12-01", "2026-12-03", "2026-12-05"]) {
      const hours = hoursOf(day)
      expect(hours[hours.length - 1]).toBe("19:40")
      expect(hours).toHaveLength(18)
    }
  })

  it("domingo sigue sin turnos", () => {
    expect(hoursOf("2026-12-06")).toHaveLength(0)
  })
})
