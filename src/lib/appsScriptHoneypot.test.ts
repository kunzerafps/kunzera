import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { submitOrder } from "./appsScript"
import type { OrderDraft } from "../types/order"

// ⚠️ TEST DE REGRESIÓN CRÍTICO — no borrar.
//
// El payload que se le manda al Apps Script tiene un campo `email` que NO es
// el mail del cliente: es un HONEYPOT anti-spam. En google-apps-script/Code.gs
// línea 108:
//
//     if (body.email) return { ok: false, error: 'spam_detected' };
//
// O sea: si `email` llega con CUALQUIER cosa, el Apps Script rechaza la
// reserva entera. Un bot que autocompleta todos los campos del formulario cae
// en la trampa; una persona real nunca lo completa porque está oculto.
//
// Cuando se sumó el paso opcional del mail al chat (para mejorar la calidad
// de coincidencia de Meta), lo "natural" era mandarlo en ese campo. Habría
// hecho que TODAS las reservas del sitio fallaran con "spam_detected".
//
// Por eso el mail del cliente viaja por otro lado: capture-attribution ->
// blob `attribution-data` -> capi-confirmar-pago lo lee y lo suma al evento
// de Compra de Meta. El Apps Script no se toca (vive en Google, fuera de
// este repo).
//
// Este test falla si alguien vuelve a meter el mail en el payload del Sheet.

const draft: OrderDraft = {
  pack: "platino",
  monto: 50000,
  nombre: "Juan Perez",
  whatsapp: "3511234567",
  discord: "-",
  turno: "2026-09-05T15:00:00.000Z",
  email: "cliente@gmail.com", // el mail opcional que dejó en el chat
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ ok: true, fileUrl: "-", timestamp: "x" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  )
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function sentPayload() {
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  return JSON.parse(String(init.body))
}

describe("submitOrder — el campo `email` del Apps Script es un honeypot anti-spam", () => {
  it("NUNCA manda el mail del cliente al Sheet: lo rechazaría como spam y se perdería la reserva", async () => {
    const result = await submitOrder(draft, "key-honeypot-1")

    expect(result.ok).toBe(true)
    const payload = sentPayload()
    // El honeypot tiene que llegar vacío/ausente, pase lo que pase.
    expect(payload.email).toBeUndefined()
    // Y el mail no puede aparecer en NINGÚN campo del payload.
    expect(JSON.stringify(payload)).not.toContain("cliente@gmail.com")
  })

  it("el resto de los datos de la reserva sí viajan normalmente", async () => {
    await submitOrder(draft, "key-honeypot-2")

    const payload = sentPayload()
    expect(payload.nombre).toBe("Juan Perez")
    expect(payload.whatsapp).toBe("3511234567")
    expect(payload.plan).toBe("platino")
    expect(payload.monto).toBe(50000)
    expect(payload.idempotencyKey).toBe("key-honeypot-2")
  })
})
