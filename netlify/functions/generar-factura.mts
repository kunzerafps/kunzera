import type { Config, Context } from "@netlify/functions"
import { verifySessionToken } from "./lib/adminSession"
import { invoiceOrderNow } from "./lib/facturacion"
import type { Pack } from "../../src/types/order"

type Body = {
  token?: string
  idempotencyKey?: string
  nombre?: string
  plan?: string
  monto?: number | string
  turno?: string
}

// Único punto de entrada para facturar: lo llama el botón "Generar factura"
// del panel admin, reserva por reserva. No hay ningún otro disparador — ver
// invoiceOrderNow en lib/facturacion.ts para el detalle de por qué se pasó
// de facturación automática a 100% manual.
export default async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return Response.json({ ok: false, error: "invalid_body" }, { status: 400 })
  }

  if (!verifySessionToken(body.token)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }

  if (!body.idempotencyKey || !body.nombre || !body.plan || !body.turno || body.monto === undefined) {
    return Response.json({ ok: false, error: "missing_field" }, { status: 400 })
  }

  const result = await invoiceOrderNow({
    idempotencykey: body.idempotencyKey,
    nombre: body.nombre,
    plan: body.plan as Pack,
    monto: Number(body.monto) || 0,
    turno: body.turno,
  })

  return Response.json(result, { status: result.ok ? 200 : 400 })
}

export const config: Config = {
  path: "/api/generar-factura",
}
