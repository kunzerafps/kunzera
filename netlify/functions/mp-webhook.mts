import type { Context } from "@netlify/functions"
import { createHmac, timingSafeEqual } from "node:crypto"
import { getStore } from "@netlify/blobs"
import { submitOrder, updateOrderStatus } from "../../src/lib/appsScript"
import { invoiceOrderIfNeeded } from "./lib/facturacion"
import type { Pack } from "../../src/types/order"

const PROCESSED_STORE = "mp-webhook-processed"
const ALERTED_STORE = "mp-webhook-alerted"
// No es secreto: es el mismo ID que ya está público en index.html (fbq('init', ...)).
const META_PIXEL_ID = "761377043609509"

// Mercado Pago puede reenviar la misma notificación más de una vez (a
// propósito, por diseño). Marcamos "procesado" recién cuando submitOrder
// termina (éxito o fracaso definitivo) — NUNCA antes. Si marcáramos antes y
// esta función se corta a la mitad (ej: Apps Script tarda más que el límite
// de ejecución de Netlify, algo que ya le pasó a este proyecto), quedaría
// "marcado como resuelto" un pago que en realidad nunca generó la reserva —
// y como Mercado Pago reintenta el aviso más adelante, ese reintento
// quedaría ignorado para siempre pensando que ya se había atendido.
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

// Mercado Pago manda distintos "topics"/"types" de notificación a la misma
// notification_url (payment, merchant_order, etc. — merchant_order se puede
// activar a nivel cuenta en "Tus integraciones" sin que este código se
// entere). Si algún día se activa otro topic, su "id" NO es un ID de pago —
// tratarlo como tal pegaría contra /v1/payments/{id} con un ID que
// corresponde a otra cosa. Si el topic viene informado y no es "payment",
// lo ignoramos de entrada.
function isPaymentTopic(topic: string | null): boolean {
  return !topic || topic === "payment"
}

async function getPaymentId(req: Request): Promise<string | null> {
  const url = new URL(req.url)
  const topicFromQuery = url.searchParams.get("topic") || url.searchParams.get("type")
  const fromQuery = url.searchParams.get("data.id") || url.searchParams.get("id")
  if (fromQuery) return isPaymentTopic(topicFromQuery) ? fromQuery : null

  if (req.method === "POST") {
    try {
      const body = (await req.json()) as { type?: unknown; data?: { id?: unknown } }
      const topicFromBody = typeof body?.type === "string" ? body.type : null
      if (body?.data?.id) return isPaymentTopic(topicFromBody) ? String(body.data.id) : null
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

// Aviso de respaldo para CUALQUIER motivo por el que un pago se acredite
// pero la reserva no se llegue a crear (turno ocupado, Apps Script caído,
// lo que sea). La reserva "de verdad" (con el mensaje normal de "Nueva
// reserva Kunzera") la manda el propio Apps Script cuando submitOrder crea
// la fila — pero si eso falla, de otro modo Eze no se entera de que hay
// plata cobrada sin ninguna reserva del otro lado. Si no está configurado
// MP_DISCORD_WEBHOOK_URL, no manda nada.
async function notifyOrderFailed(
  paymentId: string,
  idempotencyKey: string,
  meta: NonNullable<MpPayment["metadata"]>,
  reason: string,
): Promise<void> {
  const isSlotTaken = reason === "slot_taken"
  const content = [
    isSlotTaken
      ? "⚠️ **Pago de Mercado Pago acreditado, pero el turno ya estaba ocupado**"
      : "⚠️ **Pago de Mercado Pago acreditado, pero la reserva no se pudo crear**",
    `${meta.nombre || "-"} — ${meta.plan || "-"} — turno ${meta.turno || "-"}`,
    `WhatsApp: ${meta.whatsapp || "-"}`,
    `ID interno: ${idempotencyKey.slice(0, 8)}…`,
    isSlotTaken
      ? "Revisar y coordinar otro horario o reembolso manualmente."
      : `Motivo: ${reason}. Revisar y crear la reserva a mano o coordinar con el cliente.`,
  ].join("\n")
  await notifyGenericIssue(paymentId, content)
}

// Evita mandar el mismo aviso de "no pude verificar este pago" varias veces
// — Mercado Pago reintenta la notificación si no marcamos "procesado", y acá
// justamente no lo marcamos a propósito (ver más abajo) para poder
// reintentar solos en la próxima notificación. Sin este freno, cada
// reintento de MP durante una caída mandaría un mensaje nuevo a Discord.
async function alreadyAlerted(paymentId: string): Promise<boolean> {
  try {
    const store = getStore(ALERTED_STORE)
    return (await store.get(paymentId, { consistency: "strong" })) !== null
  } catch {
    return false
  }
}

async function markAlerted(paymentId: string): Promise<void> {
  try {
    const store = getStore(ALERTED_STORE)
    await store.set(paymentId, "1")
  } catch (err) {
    console.error("[mp-webhook] no se pudo marcar la alerta como enviada:", err)
  }
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

// Normaliza a como Meta espera el teléfono para el hash: sólo dígitos, con
// código de país, sin el "0" de larga distancia local (ej. "011 2345-6789"
// → "1123456789" antes de anteponer "549"). Mismo criterio de "549" que ya
// usa el panel admin para armar links de WhatsApp (OrderDetailModal.tsx),
// más el agregado de sacar el 0 inicial que ese código no contempla.
function normalizePhoneForHash(whatsapp: string): string {
  let digits = whatsapp.replace(/\D/g, "")
  if (digits.startsWith("549")) return digits
  if (digits.startsWith("54") && digits.length > 10) digits = digits.slice(2)
  if (digits.startsWith("0")) digits = digits.slice(1)
  return "549" + digits
}

// Manda el evento de Compra a Meta desde el servidor, en el momento exacto
// en que la reserva se confirma de verdad (no cuando Mercado Pago redirige
// al navegador, que puede pasar sin que la reserva llegue a crearse). Esto
// reemplaza al píxel del navegador para el flujo de Mercado Pago — además
// de ser más preciso, captura compras que el píxel pierde por bloqueadores
// de anuncios o las protecciones de privacidad de Safari/iOS.
async function sendMetaPurchaseEvent(
  idempotencyKey: string,
  meta: NonNullable<MpPayment["metadata"]>,
): Promise<void> {
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN
  if (!accessToken) return

  try {
    const userData: Record<string, string[]> = {}
    if (meta.whatsapp) {
      userData.ph = [await sha256Hex(normalizePhoneForHash(meta.whatsapp))]
    }
    if (meta.nombre) {
      const [first, ...rest] = meta.nombre.trim().toLowerCase().split(/\s+/)
      if (first) userData.fn = [await sha256Hex(first)]
      if (rest.length) userData.ln = [await sha256Hex(rest.join(" "))]
    }

    // Igual que postJson/getJson en appsScript.ts: timeout explícito para no
    // quedar colgados de una API externa. Va después de updateOrderStatus
    // en la ruta crítica, así que un cuelgue acá ya no arriesga dejar la
    // reserva a medio confirmar — pero sin timeout, la función podría
    // superar el límite de ejecución de Netlify sin que MP reciba el 200 a
    // tiempo, y como el pago ya quedó marcado "procesado", un reintento de
    // MP no volvería a intentar mandar este evento nunca más.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    let res: Response
    try {
      res = await fetch(
        `https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(accessToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data: [
              {
                event_name: "Purchase",
                event_time: Math.floor(Date.now() / 1000),
                action_source: "website",
                event_id: idempotencyKey,
                user_data: userData,
                custom_data: {
                  currency: "ARS",
                  value: Number(meta.monto) || 0,
                  content_name: meta.plan,
                  content_type: "product",
                },
              },
            ],
          }),
          signal: controller.signal,
        },
      )
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => "")
      console.error("[mp-webhook] error mandando evento a Meta:", res.status, errText)
      // Clave de alerta separada de la del pago (namespace "capi-") — esto
      // es un problema de tracking de anuncios, no de la reserva en sí, y
      // no debe compartir el freno anti-spam con esos otros avisos.
      await notifyGenericIssue(
        `capi-${idempotencyKey}`,
        `⚠️ **No se pudo mandar el evento de Compra a Meta** (reserva ${idempotencyKey.slice(0, 8)}…, HTTP ${res.status})\nLa reserva está bien creada — esto solo afecta el tracking de anuncios. Revisar si el token de la API de Conversiones sigue vigente.`,
      )
    }
  } catch (err) {
    console.error("[mp-webhook] no se pudo mandar el evento de Compra a Meta:", err)
    await notifyGenericIssue(
      `capi-${idempotencyKey}`,
      `⚠️ **Error inesperado mandando el evento de Compra a Meta** (reserva ${idempotencyKey.slice(0, 8)}…)\n${String(err)}`,
    )
  }
}

// Helper genérico: manda un mensaje de texto libre a Discord, con el mismo
// freno anti-spam por clave (alreadyAlerted/markAlerted) que ya usan
// notifyOrderFailed y notifyWebhookIssue. La clave decide qué se considera
// "el mismo problema" — pasar claves con distinto namespace (ej. "capi-")
// para que un aviso no tape a otro de un motivo distinto sobre el mismo pago.
async function notifyGenericIssue(alertKey: string, content: string): Promise<void> {
  const webhookUrl = process.env.MP_DISCORD_WEBHOOK_URL
  if (!webhookUrl) return
  if (await alreadyAlerted(alertKey)) return

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    })
    await markAlerted(alertKey)
  } catch (err) {
    console.error("[mp-webhook] no se pudo avisar el problema a Discord:", err)
  }
}

// Aviso de respaldo para cuando ni siquiera pudimos averiguar el estado del
// pago (falla de red, Mercado Pago caído, respuesta inesperada). A
// diferencia de notifyOrderFailed, acá no tenemos los datos del cliente
// todavía — solo el ID de pago, para que se pueda revisar a mano en el
// panel de Mercado Pago.
async function notifyWebhookIssue(paymentId: string, reason: string): Promise<void> {
  const content = [
    "⚠️ **No se pudo verificar una notificación de pago de Mercado Pago**",
    `ID de pago: ${paymentId}`,
    `Motivo: ${reason}`,
    "Revisar este pago manualmente en el panel de Mercado Pago — puede que haya plata cobrada sin reserva creada.",
  ].join("\n")
  await notifyGenericIssue(paymentId, content)
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
      await notifyWebhookIssue(paymentId, `Mercado Pago devolvió HTTP ${payRes.status} al consultar el pago`)
      return new Response(null, { status: 200 })
    }

    const payment = (await payRes.json()) as MpPayment
    const idempotencyKey = payment.external_reference
    const meta = payment.metadata

    if (payment.status === "approved" && idempotencyKey && meta?.nombre && meta?.turno) {
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

      if (!orderResult.ok && orderResult.error === "slot_taken") {
        // Mercado Pago puede reenviar la misma notificación dos veces casi
        // en simultáneo (ver alreadyProcessed): las dos entregas pueden
        // pasar el chequeo de "¿ya procesado?" antes de que la primera
        // termine de marcarlo. La segunda entrega llega a submitOrder,
        // encuentra el turno recién tomado por SU PROPIA reserva (la que
        // creó la primera entrega) y lo reporta como "ocupado" — un falso
        // conflicto, no una reserva ajena pisada. updateOrderStatus con este
        // mismo idempotencyKey nos dice cuál es el caso: si existe una fila
        // con esta key, el turno lo ocupa nuestra propia reserva.
        const ownRow = await updateOrderStatus(idempotencyKey, "confirmado")
        // Definitivo en cualquier caso: reintentar no lo va a cambiar.
        await markProcessed(paymentId)
        if (ownRow.ok) {
          await sendMetaPurchaseEvent(idempotencyKey, meta)
        } else {
          console.error("[mp-webhook] no se pudo crear la reserva", idempotencyKey, orderResult.error)
          await notifyOrderFailed(paymentId, idempotencyKey, meta, orderResult.error)
        }
      } else if (!orderResult.ok) {
        console.error("[mp-webhook] no se pudo crear la reserva", idempotencyKey, orderResult.error)
        await notifyOrderFailed(paymentId, idempotencyKey, meta, orderResult.error)
        // Puede ser transitorio (ej. Apps Script caído un momento) — no
        // marcamos procesado, para que una futura notificación del mismo
        // pago pueda reintentarlo solo.
      } else {
        await markProcessed(paymentId)
        // updateOrderStatus va primero: es lo importante (que la planilla
        // quede bien). El aviso a Meta es un beneficio aparte — si se
        // cortara acá, mejor que ya haya quedado "confirmado" en la
        // planilla antes de arriesgar esa llamada extra.
        const statusResult = await updateOrderStatus(idempotencyKey, "confirmado")
        if (!statusResult.ok) {
          console.error(
            "[mp-webhook] reserva creada pero no se pudo confirmar el estado",
            idempotencyKey,
            statusResult.error,
          )
        }
        await sendMetaPurchaseEvent(idempotencyKey, meta)
        // Mercado Pago siempre se factura al toque (ya estamos en un
        // contexto de servidor confiable) — no hace falta esperar al
        // escaneo periódico de facturar-pendientes.mts, que igual la cubre
        // como red de respaldo si esto llegara a fallar.
        await invoiceOrderIfNeeded({
          idempotencykey: idempotencyKey,
          nombre: meta.nombre,
          // submitOrder ya validó que meta.plan sea un Pack válido (si no,
          // orderResult.ok sería false y no llegaríamos hasta acá).
          plan: meta.plan as Pack,
          monto: Number(meta.monto) || 0,
          turno: meta.turno,
        })
      }
    }
  } catch (err) {
    console.error("[mp-webhook] error procesando notificación:", err)
    await notifyWebhookIssue(paymentId, `Error inesperado procesando la notificación: ${String(err)}`)
  }

  // Siempre 200: si devolvemos error, Mercado Pago reintenta indefinidamente.
  return new Response(null, { status: 200 })
}

export const config = {
  path: "/api/mp-webhook",
}
