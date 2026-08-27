import type { Config, Context } from "@netlify/functions"
import { verifySessionToken } from "./lib/adminSession"
import { listManualSales } from "./lib/manualSalesStore"

// Solo lectura: devuelve el registro de ventas cerradas por WhatsApp (ver
// lib/manualSalesStore.ts) para la pantalla "Ventas por WhatsApp" del panel.
// Mismo patrón de auth que capi-delivery-log.mts (token de sesión en la
// query, GET).
export default async (req: Request, _ctx: Context): Promise<Response> => {
  const url = new URL(req.url)
  const token = req.method === "GET" ? url.searchParams.get("token") : null

  if (!verifySessionToken(token)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }

  const limitParam = Number(url.searchParams.get("limit"))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 1000) : 500

  try {
    const ventas = await listManualSales(limit)
    return Response.json({ ok: true, ventas })
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

export const config: Config = {
  path: "/api/capi-venta-manual-list",
}
