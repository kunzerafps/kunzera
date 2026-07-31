import type { Config, Context } from "@netlify/functions"
import { getOrders } from "../../src/lib/appsScript"
import { invoiceOrderIfNeeded } from "./lib/facturacion"

// Escaneo periódico: cubre la facturación de transferencia (que no tiene
// ningún gancho de servidor propio, a diferencia de Mercado Pago) y sirve
// de red de respaldo si el intento inmediato de mp-webhook.mts llegara a
// fallar. invoiceOrderIfNeeded ya es un no-op seguro para Binance, para
// reservas ya facturadas, y si las credenciales todavía no están cargadas.
//
// Netlify no deja invocar sus "scheduled functions" por HTTP público (las
// bloquea a propósito), así que en vez de eso este queda como un endpoint
// normal — se dispara desde un cron externo gratuito (ej. cron-job.org)
// pegándole a esta URL cada 15 minutos. Ver plan para la guía de alta.
export default async (req: Request, _ctx: Context): Promise<Response> => {
  // Protegido con un secreto compartido (CRON_SECRET) para que no cualquiera
  // en internet pueda golpear este endpoint y forzar escaneos repetidos.
  // El cron externo se configura para mandar ?key=<CRON_SECRET>.
  const expected = process.env.CRON_SECRET
  if (expected) {
    const url = new URL(req.url)
    if (url.searchParams.get("key") !== expected) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401 })
    }
  }

  const orders = await getOrders()

  let procesadas = 0
  for (const order of orders) {
    if (!order.idempotencykey) continue
    await invoiceOrderIfNeeded(order)
    procesadas++
  }

  return Response.json({ ok: true, revisadas: procesadas })
}

export const config: Config = {
  path: "/api/facturar-pendientes",
}
