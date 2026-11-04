import { describe, expect, it, vi } from "vitest"

const invoiceOrderNow = vi.hoisted(() => vi.fn())
vi.mock("../lib/facturacion", () => ({ invoiceOrderNow }))
vi.mock("../lib/adminSession", () => ({
  verifySessionToken: (t?: string) => t === "ok",
}))

import handler from "../generar-factura.mts"

const post = (body: unknown) =>
  handler(
    new Request("https://kunzera.com/api/generar-factura", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    {} as never,
  )

const reserva = {
  token: "ok",
  idempotencyKey: "abc123",
  nombre: "Cliente Prueba",
  plan: "platino",
  monto: 50000,
  turno: "2026-11-05 14:00",
}

describe("generar-factura con la facturación web desactivada", () => {
  it("rechaza y nunca llama a AFIP, aun con sesión de admin válida", async () => {
    const res = await post(reserva)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ ok: false, error: "facturacion_desactivada" })
    expect(invoiceOrderNow).not.toHaveBeenCalled()
  })

  it("sin sesión sigue respondiendo no autorizado", async () => {
    const res = await post({ ...reserva, token: "malo" })
    expect(res.status).toBe(401)
  })
})
