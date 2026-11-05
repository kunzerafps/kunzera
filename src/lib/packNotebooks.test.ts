import { describe, expect, it } from "vitest"
import { detectPayload, initialContext, reduce } from "./chatFlow"
import type { FlowContext } from "./chatFlow"
import type { FlowEvent } from "../types/order"
import { mpTotal, MP_FEE_RATE } from "./pricing"
import { PACKS } from "./packs"

function run(events: FlowEvent[], start: FlowContext = initialContext()): FlowContext {
  return events.reduce((ctx, ev) => reduce(ctx, ev), start)
}

describe("pack Notebooks", () => {
  it("sale $60.000 y por Mercado Pago le quedan al menos $60.000 netos", () => {
    expect(PACKS.notebooks.price).toBe(60000)
    const total = mpTotal(PACKS.notebooks.price)
    expect(total).toBe(68000)
    expect(total * (1 - MP_FEE_RATE)).toBeGreaterThanOrEqual(60000)
  })

  it("el texto libre lo elige sin pisar a los otros packs", () => {
    expect(detectPayload("quiero el plan notebooks")).toBe("notebooks")
    expect(detectPayload("tengo una laptop")).toBe("notebooks")
    expect(detectPayload("es portátil")).toBe("notebooks")
    expect(detectPayload("quiero el diamante")).toBe("diamante")
  })

  it("el chip del pack lo deja elegido con su precio", () => {
    const ctx = run([
      { type: "OPEN" },
      { type: "SELECT_CHIP", payload: "notebooks", label: "Quiero Notebooks" },
    ])
    expect(ctx.state).toBe("planPicked")
    expect(ctx.draft.pack).toBe("notebooks")
    expect(ctx.draft.monto).toBe(60000)
  })
})
