import type { Config, Context } from "@netlify/functions"
import { verifySessionToken } from "./lib/adminSession"
import { sendMetaPurchaseEvent, normalizePhoneForHash, MAX_EVENT_AGE_DAYS } from "./lib/metaCapi"
import { notifyDiscord } from "./lib/discordAlert"
import { isRateLimited } from "./lib/rateLimit"
import { getPhoneAttribution } from "./lib/attribution"
import { sha256Hex } from "./lib/metaUserData"
import {
  generateManualSaleId,
  getManualSaleByEvent,
  saveManualSale,
  type ManualSale,
} from "./lib/manualSalesStore"

type Body = {
  token?: string
  nombre?: string
  whatsapp?: string
  email?: string
  monto?: number | string
  pack?: string
  // De qué campaña/anuncio vino (lo que el admin ve en WhatsApp Business).
  // Opcional, texto libre.
  campania?: string
  fecha?: string // YYYY-MM-DD, opcional — default hoy (hora Argentina)
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/
// Validación deliberadamente laxa: exige "algo@algo.algo" sin espacios y
// nada más. No es tarea de este endpoint decidir si un dominio existe; sí
// evita mandar a Meta un `em` que claramente no es un email.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RATE_LIMIT_MAX = 30
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

// Argentina es UTC-3 fijo (sin horario de verano desde 2009) — restar 3hs
// antes de cortar la fecha evita que, entre las 21:00 y 23:59 hora local,
// "hoy" se calcule mal como el día siguiente en UTC.
function todayInArgentina(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function daysAgoInArgentina(days: number): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000 - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

// Determinístico por (teléfono, monto, día): si el admin carga la misma
// venta dos veces sin querer el mismo día, Meta la deduplica sola contra el
// event_id repetido en vez de contarla dos veces — no hace falta ningún
// store extra para eso. Contrapartida conocida y aceptada: si el mismo
// cliente compra dos veces de verdad el mismo día por el mismo monto, la
// segunda queda absorbida como "duplicado" — casuística rara, no hay forma
// de distinguirla sin guardar más estado del que vale la pena para este caso.
async function offlineEventId(whatsapp: string, monto: number, fecha: string): Promise<string> {
  const data = new TextEncoder().encode(
    `offline-${normalizePhoneForHash(whatsapp)}-${monto}-${fecha}`,
  )
  const hash = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

// Ventas que se cierran 100% por WhatsApp, sin que el cliente pase nunca por
// el sitio — hoy no dejan ningún rastro (ni reserva, ni comprobante, ni
// idempotencyKey), así que Meta jamás se entera de que existieron pese a que
// muchas sí vienen de un anuncio. Este endpoint SOLO manda el evento de
// Compra a Meta como conversión cerrada por mensajería (action_source
// "business_messaging", la categoría que Meta define específicamente para
// esto) — a propósito no toca el Sheet de reservas ni Apps Script, esto es
// puramente para que el algoritmo de Meta sepa que la venta pasó.
export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 })
  }

  if (await isRateLimited("capi-venta-manual-rate-limit", ctx.ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 })
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

  const monto = Number(body.monto)
  const whatsappDigits = (body.whatsapp || "").replace(/\D/g, "")
  if (!body.nombre?.trim() || whatsappDigits.length < 8 || !monto || monto <= 0) {
    return Response.json({ ok: false, error: "missing_field" }, { status: 400 })
  }

  // El email es obligatorio: es la señal que más sube la calidad de
  // coincidencia con Meta en ventas por WhatsApp (no hay cookie de navegador
  // que aporte). Si en algún caso puntual el cliente no lo da, se afloja
  // esto a opcional en una línea — hoy se pide siempre a propósito.
  const email = (body.email || "").trim().toLowerCase()
  if (!EMAIL_RE.test(email)) {
    return Response.json({ ok: false, error: "email_invalido" }, { status: 400 })
  }

  const fecha = body.fecha && FECHA_RE.test(body.fecha) ? body.fecha : todayInArgentina()
  // FECHA_RE solo valida la FORMA (4 dígitos-2 dígitos-2 dígitos) — algo
  // como "2026-13-45" la pasa igual pero no es una fecha real.
  if (Number.isNaN(new Date(`${fecha}T15:00:00Z`).getTime())) {
    return Response.json({ ok: false, error: "fecha_invalida" }, { status: 400 })
  }
  const hoy = todayInArgentina()
  if (fecha > hoy) {
    return Response.json({ ok: false, error: "fecha_futura" }, { status: 400 })
  }
  if (fecha < daysAgoInArgentina(MAX_EVENT_AGE_DAYS)) {
    // Meta rechaza el batch entero si event_time supera esta ventana — mejor
    // frenarlo acá con un error claro que dejar que se pierda en silencio.
    return Response.json({ ok: false, error: "fecha_muy_vieja" }, { status: 400 })
  }

  // Mediodía del día indicado, en hora Argentina (UTC-3): alcanza para que
  // Meta ubique el evento en el día correcto sin depender de a qué hora
  // exacta se cargó a mano. PERO si "hoy" es el día elegido y todavía no
  // llegó el mediodía en Argentina, ese cálculo da una hora que aún no pasó
  // — y Meta rechaza cualquier event_time en el futuro (error real,
  // encontrado probando esto: "La marca de tiempo del evento es posterior a
  // la actual"). Nunca se manda más adelante que "ahora mismo".
  const eventTimeMidday = Math.floor(new Date(`${fecha}T15:00:00Z`).getTime() / 1000)
  const eventTime = Math.min(eventTimeMidday, Math.floor(Date.now() / 1000))

  // La comprobación de "fecha_muy_vieja" de arriba es de día entero, pero la
  // ventana real de Meta son ~7×24h medidos en segundos. Una venta fechada
  // justo 7 días atrás pero cargada a la tarde tiene un event_time de más de
  // 168h y Meta rechaza el lote entero — y el reintento después queda
  // trabado igual. Este chequeo fino sobre el event_time real cierra ese
  // borde (sin rechear de más: una venta de 6 días cargada a la mañana pasa).
  if (eventTime < Math.floor(Date.now() / 1000) - MAX_EVENT_AGE_DAYS * 24 * 60 * 60) {
    return Response.json({ ok: false, error: "fecha_muy_vieja" }, { status: 400 })
  }

  const eventId = await offlineEventId(body.whatsapp!, monto, fecha)

  // Si esta misma venta (mismo teléfono+monto+fecha) ya se cargó, no se crea
  // una segunda fila ni se vuelve a llamar a Meta: se devuelve la que ya
  // existe. Un envío fallido NO se reintenta por acá — para eso está el
  // botón "Reintentar Meta" de la lista, que es una acción explícita.
  const yaCargada = await getManualSaleByEvent(eventId)
  if (yaCargada) {
    return Response.json({
      ok: true,
      id: yaCargada.id,
      metaStatus: yaCargada.metaStatus,
      metaError: yaCargada.metaError,
      duplicate: true,
    })
  }

  const nombre = body.nombre!.trim()

  // Rastro del anuncio recuperado por teléfono. Si esta persona pasó antes por
  // el sitio y dejó su WhatsApp (evento Lead), guardamos su fbc/fbp/IP/id de
  // visitante en un índice (ver lib/attribution.ts). Sin esto, una venta
  // cerrada por WhatsApp le llega a Meta solo con teléfono + mail + nombre +
  // país, y la campaña que la trajo no se lleva el crédito.
  //
  // Best-effort: si no hay nada indexado (la persona nunca pasó por la web),
  // la venta se manda igual, como antes.
  const phoneTrail = await getPhoneAttribution(
    await sha256Hex(normalizePhoneForHash(body.whatsapp!)),
  ).catch(() => null)

  const result = await sendMetaPurchaseEvent({
    eventId,
    source: "venta_manual",
    actionSource: "business_messaging",
    value: monto,
    contentName: body.pack,
    whatsapp: body.whatsapp,
    nombre,
    email,
    // Todos los clientes son de Argentina — mandar el país es match gratis
    // que hasta ahora no se aprovechaba en las ventas manuales.
    // El de `phoneTrail` (geo real de la visita) gana si existe.
    countryCode: phoneTrail?.countryCode || "ar",
    fbp: phoneTrail?.fbp,
    fbc: phoneTrail?.fbc,
    clientIpAddress: phoneTrail?.ip,
    clientUserAgent: phoneTrail?.userAgent,
    city: phoneTrail?.city,
    region: phoneTrail?.region,
    postalCode: phoneTrail?.postalCode,
    externalId: phoneTrail?.visitorId,
    eventTime,
    saleDate: fecha,
  })

  if (!result.ok) {
    console.error("[capi-venta-manual] error avisando la venta a Meta:", result.error)
    await notifyDiscord(
      `capi-manual-${eventId}`,
      `⚠️ **No se pudo avisar una venta manual a Meta** (${nombre}, $${monto})\nQuedó registrada — reintentá desde el panel.\n${result.error}`,
    )
  }

  const sale: ManualSale = {
    id: generateManualSaleId(fecha),
    createdAt: Date.now(),
    saleDate: fecha,
    nombre,
    whatsapp: body.whatsapp!.trim(),
    email,
    monto,
    pack: body.pack?.trim() || undefined,
    campania: body.campania?.trim() || undefined,
    metaEventId: eventId,
    metaStatus: result.ok ? "ok" : "error",
    metaError: result.ok ? undefined : result.error,
  }

  try {
    await saveManualSale(sale)
  } catch (err) {
    // La venta ya se avisó a Meta (o se intentó) pero no quedó en el
    // registro local — se avisa para poder recargarla a mano.
    console.error("[capi-venta-manual] no se pudo guardar la venta en el registro:", err)
    const metaTxt = result.ok ? "avisada a Meta" : "con el aviso a Meta TAMBIÉN fallado"
    await notifyDiscord(
      `venta-manual-store-${eventId}`,
      `⚠️ **Venta ${metaTxt} pero NO guardada en el registro** (${nombre}, $${monto}). Revisar el store "ventas-manuales" y recargarla a mano.`,
    )
    return Response.json(
      { ok: false, error: "no_se_guardo", metaStatus: sale.metaStatus },
      { status: 500 },
    )
  }

  return Response.json({
    ok: true,
    id: sale.id,
    metaStatus: sale.metaStatus,
    metaError: sale.metaError,
  })
}

export const config: Config = {
  path: "/api/capi-venta-manual",
}
