import type { Context } from "@netlify/functions"
import { createHmac, timingSafeEqual } from "node:crypto"
import { getStore } from "@netlify/blobs"
import { submitOrder, updateOrderStatus } from "../../src/lib/appsScript"
import type { Pack } from "../../src/types/order"
import { sendMetaPurchaseEvent } from "./lib/metaCapi"
import { notifyDiscord } from "./lib/discordAlert"
import { getAttribution } from "./lib/attribution"

const PROCESSED_STORE = "mp-webhook-processed"
// Mismo store que usa tag-payment-method.mts para transferencia/binance —
// el nombre tiene que coincidir a mano porque METHOD_STORE en
// lib/facturacion.ts no está exportado (ver getPaymentMethod ahí).
const METHOD_STORE = "payment-methods"

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

// Etiqueta la reserva como pagada por Mercado Pago en el mismo store que
// tag-payment-method.mts usa para transferencia/binance — así
// getPaymentMethod() en lib/facturacion.ts sabe que hay que facturar el
// total con la comisión de MP sumada (mpTotal), no el precio base (el
// contador confirmó que hay que facturar lo que el cliente pagó de
// verdad). SIEMPRE se llama ANTES de markProcessed(paymentId) en los dos
// lugares donde se usa, a propósito: si la función se corta acá (por el
// límite real de ejecución de Netlify, ver lib/facturacion.ts) antes de
// completar el intento, el pago todavía no quedó marcado "procesado", así
// que el reintento automático de notificación de Mercado Pago nos da otra
// oportunidad de etiquetar. Si esto quedara DESPUÉS de markProcessed (como
// en la primera versión de este fix), un corte justo ahí dejaría la
// reserva sin etiqueta PARA SIEMPRE — alreadyProcessed() ignora en
// silencio cualquier reintento futuro de MP para ese mismo pago, y no hay
// ningún otro camino (ni automático ni manual desde el panel) para
// corregirlo después.
async function tagAsMercadoPago(paymentId: string, idempotencyKey: string): Promise<boolean> {
  try {
    await getStore(METHOD_STORE).set(idempotencyKey, "mercadopago")
    return true
  } catch (err) {
    console.error(
      "[mp-webhook] no se pudo etiquetar el método de pago (mercadopago):",
      idempotencyKey,
      err,
    )
    await notifyDiscord(
      `${paymentId}-mp-tag-failed`,
      [
        "⚠️ **No se pudo etiquetar una reserva como pagada por Mercado Pago**",
        `ID interno: ${idempotencyKey.slice(0, 8)}…`,
        "Si se factura sin corregir esto a mano, va a salir por el precio base en vez del total con la comisión de MP sumada — el contador pidió facturar siempre el monto real cobrado.",
        "Mercado Pago va a reintentar la notificación solo; si el problema es transitorio, se corrige solo en el próximo intento. Si no, revisar el store \"payment-methods\" en Netlify Blobs.",
      ].join("\n"),
    )
    return false
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
  // Namespace propio ("order-failed-"): antes compartía la clave desnuda
  // "paymentId" con notifyWebhookIssue, así que un reintento de MP que
  // primero fallara al consultar el pago (dispara notifyWebhookIssue) y
  // LUEGO sí lograra crear la reserva pero con otro error (dispara esto)
  // quedaba tapado en silencio por el freno anti-spam del primer aviso.
  await notifyDiscord(`order-failed-${paymentId}`, content)
}

// Manda el evento de Compra a Meta desde el servidor, en el momento exacto
// en que la reserva se confirma de verdad (no cuando Mercado Pago redirige
// al navegador, que puede pasar sin que la reserva llegue a crearse). Esto
// reemplaza al píxel del navegador para el flujo de Mercado Pago — además
// de ser más preciso, captura compras que el píxel pierde por bloqueadores
// de anuncios o las protecciones de privacidad de Safari/iOS. Va después de
// updateOrderStatus en la ruta crítica, así que un cuelgue acá ya no arriesga
// dejar la reserva a medio confirmar.
async function sendMercadoPagoCapiEvent(
  idempotencyKey: string,
  meta: NonNullable<MpPayment["metadata"]>,
): Promise<void> {
  // Política de valor (decisión explícita, no accidente de implementación):
  // se manda el precio BASE del pack ($50.000/$70.000), no lo que el
  // cliente terminó pagando con la comisión de Mercado Pago sumada
  // (~+7.77%, ver mpTotal en src/lib/pricing.ts). meta.monto ya viaja como
  // precio base desde mp-create-preference.mts. Es un criterio distinto al
  // de facturación AFIP (que sí factura el total con comisión, por regla
  // del contador) a propósito: acá el objetivo es que Meta optimice sobre
  // el valor del servicio vendido, no sobre el costo de procesamiento del
  // medio de pago elegido.
  //
  // event_time: no se pasa explícito, así que sendMetaPurchaseEvent usa
  // "ahora" — correcto acá porque este código corre DENTRO del webhook de
  // Mercado Pago, que se dispara en el momento real en que el pago se
  // aprueba (no hay demora humana de por medio, a diferencia de
  // transferencia/binance).
  const attribution = await getAttribution(idempotencyKey)
  const result = await sendMetaPurchaseEvent({
    eventId: idempotencyKey,
    source: "mercadopago",
    actionSource: "website",
    value: Number(meta.monto) || 0,
    contentName: meta.plan,
    whatsapp: meta.whatsapp,
    nombre: meta.nombre,
    fbp: attribution?.fbp,
    fbc: attribution?.fbc,
    clientIpAddress: attribution?.ip,
    clientUserAgent: attribution?.userAgent,
    city: attribution?.city,
    region: attribution?.region,
    postalCode: attribution?.postalCode,
    countryCode: attribution?.countryCode,
  })
  if (!result.ok) {
    console.error("[mp-webhook] error mandando evento a Meta:", result.error)
    // Clave de alerta separada de la del pago (namespace "capi-") — esto
    // es un problema de tracking de anuncios, no de la reserva en sí, y
    // no debe compartir el freno anti-spam con esos otros avisos.
    await notifyDiscord(
      `capi-${idempotencyKey}`,
      `⚠️ **No se pudo mandar el evento de Compra a Meta** (reserva ${idempotencyKey.slice(0, 8)}…)\nLa reserva está bien creada — esto solo afecta el tracking de anuncios. Revisar si el token de la API de Conversiones sigue vigente.\n${result.error}`,
    )
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
  // Namespace propio ("webhook-issue-") — ver comentario en notifyOrderFailed.
  await notifyDiscord(`webhook-issue-${paymentId}`, content)
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
        if (ownRow.ok) {
          // Esta entrega puede ser el reintento de una entrega anterior de
          // este mismo pago que se cortó ANTES de llegar a etiquetar el
          // método de pago (ver tagAsMercadoPago) — reintentarlo acá es la
          // red de seguridad para ese caso exacto. Si vuelve a fallar, NO
          // marcamos procesado (mismo criterio que la rama de abajo para
          // fallas transitorias): mejor darle a un futuro reintento de MP
          // otra oportunidad que perder la etiqueta para siempre.
          const tagged = await tagAsMercadoPago(paymentId, idempotencyKey)
          if (!tagged) return new Response(null, { status: 200 })
          await markProcessed(paymentId)
          // OJO: no volvemos a llamar a sendMercadoPagoCapiEvent acá — esta
          // rama es justamente la ENTREGA DUPLICADA de una notificación que
          // ya se procesó con éxito en la primera entrega (esa ya mandó el
          // evento a Meta). Repetirlo acá contaría la misma venta dos veces
          // en las métricas de conversión de Meta Ads.
        } else {
          console.error("[mp-webhook] no se pudo crear la reserva", idempotencyKey, orderResult.error)
          await notifyOrderFailed(paymentId, idempotencyKey, meta, orderResult.error)
          // Definitivo: un conflicto de turno real no lo arregla un reintento.
          await markProcessed(paymentId)
        }
      } else if (!orderResult.ok) {
        console.error("[mp-webhook] no se pudo crear la reserva", idempotencyKey, orderResult.error)
        await notifyOrderFailed(paymentId, idempotencyKey, meta, orderResult.error)
        // Puede ser transitorio (ej. Apps Script caído un momento) — no
        // marcamos procesado, para que una futura notificación del mismo
        // pago pueda reintentarlo solo.
      } else {
        // La factura NO se genera acá ni en ningún otro lugar automático —
        // Kunzera la factura a mano desde el panel admin (botón "Generar
        // factura", ver netlify/functions/generar-factura.mts) para tener
        // control total de cuándo sale cada una, incluso para Mercado Pago.
        // Sí dejamos etiquetada acá que el método fue "mercadopago" (mismo
        // store que tag-payment-method.mts usa para transferencia/binance)
        // — así, cuando el admin factura a mano, lib/facturacion.ts sabe
        // que tiene que facturar el total con la comisión de MP sumada
        // (mpTotal), no el precio base: el contador confirmó que hay que
        // facturar lo que el cliente pagó de verdad, no lo que Kunzera
        // termina recibiendo neto. Se etiqueta ANTES de markProcessed (ver
        // tagAsMercadoPago) — si esto falla, cortamos acá SIN marcar
        // procesado, para que el reintento automático de MP vuelva a pasar
        // por acá (y esta vez, como la reserva ya existe, entre por la
        // rama de arriba con ownRow.ok, que reintenta el etiquetado).
        const tagged = await tagAsMercadoPago(paymentId, idempotencyKey)
        if (!tagged) return new Response(null, { status: 200 })

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
        await sendMercadoPagoCapiEvent(idempotencyKey, meta)
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
