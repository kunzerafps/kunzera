import type { Context } from "@netlify/functions"
import { updateOrderStatus } from "../../src/lib/appsScript"

async function getPaymentId(req: Request): Promise<string | null> {
  const url = new URL(req.url)
  const fromQuery = url.searchParams.get("data.id") || url.searchParams.get("id")
  if (fromQuery) return fromQuery

  if (req.method === "POST") {
    try {
      const body = (await req.json()) as { data?: { id?: unknown } }
      if (body?.data?.id) return String(body.data.id)
    } catch {
      // el body no era JSON (o venía vacío) — ignoramos
    }
  }
  return null
}

// Mercado Pago llama a esta URL cuando un pago cambia de estado. Nunca
// confiamos en el contenido de la notificación: volvemos a pedirle el pago
// a la API de MP con el Access Token y recién ahí actuamos.
export default async (req: Request, _ctx: Context): Promise<Response> => {
  const accessToken = process.env.MP_ACCESS_TOKEN
  const paymentId = await getPaymentId(req)

  if (!accessToken || !paymentId) {
    return new Response(null, { status: 200 })
  }

  try {
    const payRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!payRes.ok) {
      console.error("[mp-webhook] no se pudo leer el pago", paymentId, payRes.status)
      return new Response(null, { status: 200 })
    }

    const payment = (await payRes.json()) as { status?: string; external_reference?: string }
    const idempotencyKey = payment.external_reference

    if (payment.status === "approved" && idempotencyKey) {
      const result = await updateOrderStatus(idempotencyKey, "confirmado")
      if (!result.ok) {
        console.error("[mp-webhook] no se pudo actualizar la reserva", idempotencyKey, result.error)
      }
    }
  } catch (err) {
    console.error("[mp-webhook] error procesando notificación:", err)
  }

  // Siempre 200: si devolvemos error, Mercado Pago reintenta indefinidamente.
  return new Response(null, { status: 200 })
}

export const config = {
  path: "/api/mp-webhook",
}
