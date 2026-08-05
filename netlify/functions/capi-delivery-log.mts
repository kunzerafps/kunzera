import type { Config, Context } from "@netlify/functions"
import { verifySessionToken } from "./lib/adminSession"
import { listRecentDeliveries } from "./lib/deliveryLog"

// Consulta de solo lectura sobre el log de entregas a Meta (ver
// lib/deliveryLog.ts) — responde con qué se intentó mandar, cuántas veces,
// y si Meta lo aceptó. Sin PII: el log en sí no guarda nombre/teléfono/
// monto, solo eventId + metadata de la entrega.
export default async (req: Request, _ctx: Context): Promise<Response> => {
  const url = new URL(req.url)
  const token = req.method === "GET" ? url.searchParams.get("token") : null

  if (!verifySessionToken(token)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }

  const limitParam = Number(url.searchParams.get("limit"))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50

  try {
    const entries = await listRecentDeliveries(limit)
    return Response.json({ ok: true, entries })
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

export const config: Config = {
  path: "/api/capi-delivery-log",
}
