import type { Context } from "@netlify/functions"
import { createHmac, timingSafeEqual } from "node:crypto"
import { getStore } from "@netlify/blobs"
import { submitOrder, updateOrderStatus } from "../../src/lib/appsScript"
import type { Pack } from "../../src/types/order"

const PROCESSED_STORE = "mp-webhook-processed"

// Mercado Pago puede reenviar la misma notificación más de una vez (a
// propósito, por diseño). Sin esto, un mismo pago aprobado podría disparar la
// creación de la reserva (y su aviso a Discord) más de una vez. Marcamos
// "en proceso" ANTES de hacer nada más (no después), para dejar la ventana de
// carrera lo más chica posible frente a dos notificaciones casi simultáneas.
async function alreadyProcessed(paymentId: string): Promise<boolean> {
  try {
    const store = getStore(PROCESSED_STORE)
    return (await store.get(paymentId, { consistency: "strong" })) !== null
  } catch {
    return false // si falla Blobs, preferimos procesar de más antes que de menos
  }
}

async function markProcessed(paymentId: string): Promise<void> {
  try {
    const store = getStore(PROCESSED_STORE)
    await store.set(paymentId, "1")
  } catch (err) {
    console.error("[mp-webhook] no se pudo marcar como procesado:", err)
  }
}

type MpPayment = {
  status?: string
  external_reference?: string
  metadata?: {
    nombre?: string
    whatsapp?: string
    discord?: string
    plan?: string
    turno?: string
    monto?: number | string
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

// Aviso de respaldo SOLO para el caso raro en que dos personas paguen el
// mismo horario casi al mismo tiempo: la reserva "de verdad" (con el mensaje
// normal de "Nueva reserva Kunzera") la manda el propio Apps Script cuando
// submitOrder crea la fila. Pero si ese turno ya fue tomado por otro pago que
// llegó una fracción de segundo antes, alguien pagó y se quedó sin turno — y
// de eso Eze no se entera por ningún otro lado hasta que el cliente le
// escriba. Si no está configurado MP_DISCORD_WEBHOOK_URL, no manda nada.
async function notifyOverbooking(
  idempotencyKey: string,
  meta: NonNullable<MpPayment["metadata"]>,
): Promise<void> {
  const webhookUrl = process.env.MP_DISCORD_WEBHOOK_URL
  if (!webhookUrl) return

  const content = [
    "⚠️ **Pago de Mercado Pago acreditado, pero el turno ya estaba ocupado**",
    `${meta.nombre || "-"} — ${meta.plan || "-"} — turno ${meta.turno || "-"}`,
    `WhatsApp: ${meta.whatsapp || "-"}`,
    `ID interno: ${idempotencyKey.slice(0, 8)}…`,
    "Revisar y coordinar otro horario o reembolso manualmente.",
  ].join("\n")

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    })
  } catch (err) {
    console.error("[mp-webhook] no se pudo avisar el overbooking a Discord:", err)
  }
}

// Mercado Pago llama a esta URL cuando un pago cambia de estado. Nunca
// confiamos en el contenido de la notificación: volvemos a pedirle el pago
// a la API de MP con el Access Token y recién ahí actuamos.
//
// La reserva NO se crea antes de esto — igual que transferencia, que tampoco
// reserva nada hasta que se sube el comprobante. Si el pago nunca se
// completa, no queda ningún rastro en la planilla ni se bloquea el turno.
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
    if (await alreadyProcessed(paymentId)) {
      return new Response(null, { status: 200 })
    }

    const payRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!payRes.ok) {
      console.error("[mp-webhook] no se pudo leer el pago", paymentId, payRes.status)
      return new Response(null, { status: 200 })
    }

    const payment = (await payRes.json()) as MpPayment
    const idempotencyKey = payment.external_reference
    const meta = payment.metadata

    if (payment.status === "approved" && idempotencyKey && meta?.nombre && meta?.turno) {
      // Marcamos ANTES de crear la reserva: si llega una notificación
      // duplicada mientras esta sigue en curso, la de abajo la va a frenar.
      await markProcessed(paymentId)

      const orderResult = await submitOrder(
        {
          nombre: meta.nombre,
          whatsapp: meta.whatsapp || "",
          discord: meta.discord || "-",
          pack: (meta.plan as Pack) || undefined,
          monto: Number(meta.monto) || 0,
          turno: meta.turno,
          idempotencyKey,
        },
        idempotencyKey,
      )

      if (!orderResult.ok) {
        if (orderResult.error === "slot_taken") {
          console.error(
            "[mp-webhook] pago aprobado pero el turno ya estaba tomado",
            idempotencyKey,
            meta.turno,
          )
          await notifyOverbooking(idempotencyKey, meta)
        } else {
          console.error("[mp-webhook] no se pudo crear la reserva", idempotencyKey, orderResult.error)
        }
      } else {
        const statusResult = await updateOrderStatus(idempotencyKey, "confirmado")
        if (!statusResult.ok) {
          console.error(
            "[mp-webhook] reserva creada pero no se pudo confirmar el estado",
            idempotencyKey,
            statusResult.error,
          )
        }
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
