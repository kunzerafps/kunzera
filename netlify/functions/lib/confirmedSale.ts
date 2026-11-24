import { sendMetaPurchaseEvent, MAX_EVENT_AGE_DAYS } from "./metaCapi"
import { sendConfirmedBookingScheduleEvent } from "./metaCapiFunnel"
import { notifyDiscord } from "./discordAlert"
import { getAttribution, getPhoneFbc } from "./attribution"
import { getPaymentMethod } from "./facturacion"

// Aviso a Meta de una venta por transferencia/Binance ya cobrada: Compra +
// Reserva (Schedule). Lo usan dos caminos:
//  - capi-confirmar-pago.mts: el botón "Marcar como atendido" del panel, el
//    "Reintentar aviso a Meta" y el barrido automático.
//  - transfer-check.mts: apenas aparece en Mercado Pago el pago de esa
//    reserva ("Transferencia encontrada"), unos 5 minutos después de reservar.
// Los dos mandan el MISMO evento (eventId = idempotencyKey) y metaCapi lo
// deduplica: el que llega segundo no cuenta la venta dos veces.
export type ConfirmedSale = {
  idempotencyKey: string
  nombre: string
  whatsapp?: string
  plan?: string
  monto: number | string
  // Timestamp de creación de la reserva (order.timestamp) — es el momento
  // verificable más cercano a cuándo el cliente realmente pagó (subió el
  // comprobante ahí), a diferencia de cuándo se confirma, que puede ser
  // horas o días después.
  reservaTimestamp?: string
}

export type ConfirmedSaleResult = { ok: boolean; error?: string }

// Política de event_time para transferencia/binance: se usa el momento en
// que se CREÓ la reserva (cliente subió comprobante), no el momento en que
// se confirma. Si esa fecha ya superó la ventana de 7 días que tolera la
// Conversions API, usar igual esa fecha haría que Meta rechace el evento
// ENTERO — mejor mandar el evento con "ahora" (perdiendo precisión en el
// timestamp) que perder la señal de venta por completo.
function resolveEventTime(reservaTimestamp: string | undefined): number | undefined {
  if (!reservaTimestamp) return undefined
  const ms = Date.parse(reservaTimestamp)
  if (Number.isNaN(ms)) return undefined
  const ageDays = (Date.now() - ms) / (24 * 60 * 60 * 1000)
  if (ageDays > MAX_EVENT_AGE_DAYS || ageDays < 0) return undefined
  return Math.floor(ms / 1000)
}

export async function sendConfirmedSale(sale: ConfirmedSale): Promise<ConfirmedSaleResult> {
  // El teléfono viene de la planilla, que puede devolver una celda de sólo
  // dígitos como número. La normalización espera texto: con un número tiraba
  // excepción y la Compra y la Reserva NO salían. Medido el 29/09/2026: 0
  // fallas en 203 compras, o sea que hoy llega como texto — esto es blindaje.
  const whatsapp =
    typeof sale.whatsapp === "number" ? String(sale.whatsapp) : sale.whatsapp

  // Política de valor: precio real de la reserva (transferencia/binance no
  // tienen comisión de medio de pago como Mercado Pago — lo que el cliente
  // transfirió/mandó en USDT es exactamente order.monto).
  //
  // El panel también llama a capi-confirmar-pago para reservas de Mercado
  // Pago (el botón "Marcar como atendido" sirve para cualquier reserva). El
  // evento en sí no se duplica (sendMetaPurchaseEvent dedupea por eventId),
  // pero el `source` que queda en el log de entregas SÍ hay que resolverlo
  // bien acá, o una venta real de MP queda etiquetada como transferencia
  // para siempre en capi-delivery-log.
  const metodo = await getPaymentMethod(sale.idempotencyKey)
  const source = metodo === "mercadopago" ? "mercadopago" : "transferencia_binance"
  // Clic del anuncio: el del navegador donde pagó; si no lo trae, el que quedó
  // guardado por teléfono (entró desde Instagram, compró desde Chrome).
  const [attribution, phoneFbc] = await Promise.all([
    getAttribution(sale.idempotencyKey),
    getPhoneFbc(whatsapp),
  ])
  const fbc = attribution?.fbc || phoneFbc

  // Se comparte entre Purchase y Schedule para que los dos eventos de esta
  // misma venta caigan en la misma ventana de atribución de Meta.
  const eventTime = resolveEventTime(sale.reservaTimestamp)

  const userData = {
    value: Number(sale.monto),
    contentName: sale.plan,
    whatsapp,
    nombre: sale.nombre,
    // Mail que la persona dejó en el chat. Viene del blob de atribución y no
    // del Sheet, porque el campo `email` del Apps Script es un honeypot
    // anti-spam (Code.gs:108).
    email: attribution?.email,
    fbp: attribution?.fbp,
    fbc,
    clientIpAddress: attribution?.ip,
    clientUserAgent: attribution?.userAgent,
    city: attribution?.city,
    region: attribution?.region,
    postalCode: attribution?.postalCode,
    countryCode: attribution?.countryCode,
    externalId: attribution?.visitorId,
    eventTime,
  }

  // "Schedule" (reserva confirmada), EN PARALELO al Purchase. event_id + store
  // de dedup propios: si esto corre sobre una reserva de MP, deduplica contra
  // el que ya mandó mp-webhook.mts. Sin alerta: señal blanda, la Compra ya
  // avisa si falla.
  const schedulePromise = sendConfirmedBookingScheduleEvent({
    idempotencyKey: sale.idempotencyKey,
    ...userData,
  }).catch((err) => {
    console.error("[confirmedSale] error mandando Schedule a Meta:", err)
    return { ok: false as const, error: String(err) }
  })

  const result = await sendMetaPurchaseEvent({
    eventId: sale.idempotencyKey,
    source,
    actionSource: "website",
    ...userData,
  })

  if (!result.ok) {
    console.error("[confirmedSale] error mandando evento a Meta:", result.error)
    // Namespace "capi-" separado del resto de los avisos — mismo store de
    // Discord, pero es un problema de tracking, no de la reserva.
    await notifyDiscord(
      `capi-${sale.idempotencyKey}`,
      `⚠️ **No se pudo mandar el evento de Compra a Meta** (reserva ${sale.idempotencyKey.slice(0, 8)}…, ${source})\nLa reserva está bien confirmada — esto solo afecta el tracking de anuncios.\n${result.error}`,
    )
  }

  await schedulePromise
  return { ok: result.ok, error: result.ok ? undefined : result.error }
}
