import { describe, expect, it } from "vitest"
import { detectPayload, initialContext, reduce } from "./chatFlow"
import type { FlowContext } from "./chatFlow"
import type { FlowEvent } from "../types/order"
import { mpTotal, MP_FEE_RATE } from "./pricing"
import { PACKS } from "./packs"

function run(events: FlowEvent[], start: FlowContext = initialContext()): FlowContext {
  return events.reduce((ctx, ev) => reduce(ctx, ev), start)
}

describe("pack Diamante + Formateo", () => {
  it("por Mercado Pago le quedan al menos $100.000 netos", () => {
    const total = mpTotal(PACKS.formateo.price)
    expect(total).toBe(113000)
    expect(total * (1 - MP_FEE_RATE)).toBeGreaterThanOrEqual(100000)
  })

  it("el texto libre con 'formateo' elige este pack, no Diamante", () => {
    expect(detectPayload("quiero el diamante + formateo")).toBe("formateo")
    expect(detectPayload("me formatean?")).toBe("formateo")
    expect(detectPayload("quiero el diamante")).toBe("diamante")
  })

  it("el chip del pack lo deja elegido con su precio", () => {
    const ctx = run([
      { type: "OPEN" },
      { type: "SELECT_CHIP", payload: "formateo", label: "Quiero Diamante + Formateo" },
    ])
    expect(ctx.state).toBe("planPicked")
    expect(ctx.draft.pack).toBe("formateo")
    expect(ctx.draft.monto).toBe(100000)
  })
})
