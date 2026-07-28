import type { Context } from "@netlify/functions"
import { createHmac, timingSafeEqual } from "node:crypto"
import { getStore } from "@netlify/blobs"
import { updateOrderStatus } from "../../src/lib/appsScript"
import { formatARS } from "../../src/lib/formatters"

const NOTIFIED_STORE = "mp-webhook-notified"

// Mercado Pago puede reenviar la misma notificación más de una vez (a
// propósito, por diseño). Sin esto, un mismo pago aprobado mandaría el aviso
// de Discord repetido cada vez que llega el reenvío.
async function alreadyNotified(paymentId: string): Promise<boolean> {
  try {
    const store = getStore(NOTIFIED_STORE)
    return (await store.get(paymentId)) !== null
  } catch {
    return false // si falla Blobs, preferimos avisar de más antes que de menos
  }
}

async function markNotified(paymentId: string): Promise<void> {
  try {
    const store = getStore(NOTIFIED_STORE)
    await store.set(paymentId, "1")
  } catch (err) {
    console.error("[mp-webhook] no se pudo marcar como notificado:", err)
  }
}

type MpPayment = {
  status?: string
  external_reference?: string
  transaction_amount?: number
  description?: string
  payer?: { email?: string }
}

// Aviso aparte (opcional) para que Eze se entere apenas un pago de Mercado
// Pago se acredita solo, sin tener que revisar el panel. Si no está
// configurado MP_DISCORD_WEBHOOK_URL, simplemente no manda nada.
async function notifyDiscordConfirmed(payment: MpPayment): Promise<void> {
  const webhookUrl = process.env.MP_DISCORD_WEBHOOK_URL
  if (!webhookUrl) return

  const amount =
    typeof payment.transaction_amount === "number" ? formatARS(payment.transaction_amount) : "—"
  const ref = payment.external_reference ? payment.external_reference.slice(0, 8) : "—"
  const lines = [
    "💰 **Pago confirmado automáticamente vía Mercado Pago**",
    payment.description || "Kunzera",
    `Monto: ${amount}`,
  ]
  if (payment.payer?.email) lines.push(`Email pagador: ${payment.payer.email}`)
  lines.push(`ID interno: ${ref}…`)

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: lines.join("\n") }),
    })
  } catch (err) {
    console.error("[mp-webhook] no se pudo avisar a Discord:", err)
  }
}

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

// Valida el header x-signature que manda Mercado Pago (HMAC-SHA256 sobre
// "id:<paymentId>;request-id:<x-request-id>;ts:<ts>;" con la clave secreta
// del webhook). Si MP_WEBHOOK_SECRET no está configurado, no bloqueamos nada
// (comportamiento actual sin cambios) — queda como mejora opcional para
// activar más adelante desde el panel de MP, sin volver a tocar código.
function hasValidSignature(req: Request, dataId: string): boolean {
  const secret = process.env.MP_WEBHOOK_SECRET
  if (!secret) return true

  const signatureHeader = req.headers.get("x-signature")
  const requestId = req.headers.get("x-request-id")
  if (!signatureHeader || !requestId) return false

  const parts: Record<string, string> = {}
  for (const piece of signatureHeader.split(",")) {
    const [k, v] = piece.split("=")
    if (k && v) parts[k.trim()] = v.trim()
  }
  const ts = parts.ts
  const v1 = parts.v1
  if (!ts || !v1) return false

  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`
  const expected = createHmac("sha256", secret).update(manifest).digest("hex")

  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(v1, "hex"))
  } catch {
    return false
  }
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

  if (!hasValidSignature(req, paymentId)) {
    console.error("[mp-webhook] firma inválida, se ignora la notificación", paymentId)
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

    const payment = (await payRes.json()) as MpPayment
    const idempotencyKey = payment.external_reference

    if (payment.status === "approved" && idempotencyKey) {
      const result = await updateOrderStatus(idempotencyKey, "confirmado")
      if (!result.ok) {
        console.error("[mp-webhook] no se pudo actualizar la reserva", idempotencyKey, result.error)
      } else if (!(await alreadyNotified(paymentId))) {
        await notifyDiscordConfirmed(payment)
        await markNotified(paymentId)
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
