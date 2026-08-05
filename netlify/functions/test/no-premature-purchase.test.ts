import { beforeEach, describe, expect, it } from "vitest"
import { installFetchMock, jsonResponse } from "./helpers/fetchMock"

// Enviar una reserva (transferencia o Binance, con o sin comprobante) NO
// debe, bajo ningún camino, disparar un evento de Compra — el único lugar
// que puede hacerlo para esas dos formas de pago es capi-confirmar-pago.mts,
// llamado explícitamente por el admin (ver OrderDetailModal.tsx). Este test
// prueba el límite real: appsScript.ts (que es lo que corre cuando el
// cliente aprieta "Ya pagué" / sube el comprobante) no importa ni llama a
// nada relacionado con Meta.
const { submitOrder } = await import("../../../src/lib/appsScript")

describe("Enviar una reserva no genera Purchase (transferencia/Binance)", () => {
  it("submitOrder solo le pega a Apps Script — nunca a graph.facebook.com", async () => {
    const fm = installFetchMock()
    fm.on("script.google.com", () => jsonResponse({ ok: true, fileUrl: "-", timestamp: new Date().toISOString() }))

    await submitOrder(
      {
        nombre: "Cliente",
        whatsapp: "1123456789",
        discord: "-",
        pack: "platino",
        monto: 50000,
        turno: "2026-08-10T15:00:00.000Z",
        idempotencyKey: "no-premature-1",
      },
      "no-premature-1",
    )

    expect(fm.callsTo("graph.facebook.com")).toHaveLength(0)
    // La única llamada de red que hace es a Apps Script.
    expect(fm.calls.every((c) => !c.url.includes("graph.facebook.com"))).toBe(true)
  })
})
