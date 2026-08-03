import type { Context } from "@netlify/functions"
import { getStore } from "@netlify/blobs"

const STORE_NAME = "payment-methods"

// El sistema hoy no guarda en ningún lado si una reserva se pagó por
// transferencia o por Binance — ambas usan el mismo flujo interno hacia el
// Apps Script. Este endpoint guarda esa elección aparte, del lado nuestro,
// para que cuando el admin apriete "Generar factura" a mano
// (generar-factura.mts) el sistema sepa saltear los pagos de Binance, sin
// tener que tocar el Apps Script.
export default async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 })
  }

  const { idempotencyKey, metodo } = (body ?? {}) as {
    idempotencyKey?: unknown
    metodo?: unknown
  }

  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 6) {
    return Response.json({ ok: false, error: "invalid_idempotency_key" }, { status: 400 })
  }
  if (metodo !== "transferencia" && metodo !== "binance") {
    return Response.json({ ok: false, error: "invalid_metodo" }, { status: 400 })
  }

  try {
    const store = getStore(STORE_NAME)
    await store.set(idempotencyKey, metodo)
  } catch (err) {
    // No bloqueamos al cliente por esto — en el peor caso, generar-factura.mts
    // no encuentra la etiqueta y factura igual, tratándola como transferencia
    // (falla hacia el lado seguro: factura de más antes que perder una real).
    console.error("[tag-payment-method] no se pudo guardar:", err)
  }

  return Response.json({ ok: true })
}

export const config = {
  path: "/api/tag-payment-method",
}
