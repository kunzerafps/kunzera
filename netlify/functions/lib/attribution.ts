import { getStore } from "@netlify/blobs"

const STORE_NAME = "attribution-data"

// Datos de contexto del comprador capturados en el momento en que entra a
// pagar (ver capture-attribution.mts / PaymentStep.tsx), NO cuando se
// confirma el pago después — para transferencia/binance eso puede ser horas
// o días más tarde, momento en el que ya no hay forma de leer la IP/cookies
// reales del comprador. `fbp`/`fbc` viajan tal cual las puso el propio píxel
// de Meta en las cookies del navegador (nunca se inventan). Meta no pide
// que estos 4 campos vayan hasheados — a diferencia de teléfono/nombre/email.
export type AttributionData = {
  fbp?: string
  fbc?: string
  ip?: string
  userAgent?: string
  // De qué campaña vino la visita, leído de los parámetros utm_* del link
  // (ver src/lib/utm.ts) — solo se guarda si el link traía utm_source. Se usa
  // para mostrarlo en el panel admin (get-attribution.mts), no se le manda a
  // Meta.
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  // Geolocalización aproximada que Netlify ya resuelve gratis a partir de la
  // IP del request (ctx.geo) — no se le pregunta nada nuevo al cliente. Sin
  // hashear acá (igual que fbp/fbc/ip/userAgent); metaCapi.ts es quien hashea
  // antes de mandarlo a Meta como ct/st/zp/country.
  city?: string
  region?: string
  postalCode?: string
  countryCode?: string
  // ID propio y estable del navegador (ver src/lib/visitorId.ts) — se guarda
  // acá sin hashear; metaCapi.ts lo hashea antes de mandarlo como external_id
  // en el evento de Compra. Deja que Meta una esa compra con la visita
  // anónima previa (el PageView server-side manda el mismo id).
  visitorId?: string
  // Mail que la persona dejó en el chat (paso opcional askEmail). Se guarda
  // acá, y NO en el Sheet, porque el campo `email` del payload del Apps
  // Script es un honeypot anti-spam: Code.gs:108 rechaza la reserva entera
  // con "spam_detected" si llega con algo. Sin hashear — metaCapi.ts lo
  // normaliza y hashea antes de mandarlo como `em`.
  //
  // Es la señal que más sube la calidad de coincidencia de Meta y la que más
  // faltaba: llegaba solo en el 40% de las compras (Mercado Pago lo trae
  // solo, las ventas manuales lo piden, pero transferencia y Binance —la
  // mayoría— no lo pedían en ningún paso).
  email?: string
  capturedAt: number
}

export async function saveAttribution(idempotencyKey: string, data: AttributionData): Promise<void> {
  await getStore(STORE_NAME).setJSON(idempotencyKey, data)
}

// Best-effort: si Blobs falla o no hay nada guardado (reserva vieja, de
// antes de este cambio; o venta manual, que no tiene sesión de navegador),
// el evento de Compra se manda igual, solo que sin estos campos — degrada
// el Event Match Quality, no bloquea el tracking de la venta.
export async function getAttribution(idempotencyKey: string): Promise<AttributionData | null> {
  try {
    return (await getStore(STORE_NAME).get(idempotencyKey, { type: "json" })) as AttributionData | null
  } catch {
    return null
  }
}

// ─────────────────── Índice por teléfono (ventas por WhatsApp) ───────────────
//
// El problema que resuelve: una venta cerrada por WhatsApp y cargada a mano
// en el panel le llega a Meta con teléfono + mail + nombre + país y NADA MÁS
// — sin la cookie del clic del anuncio (fbc), sin fbp, sin IP, sin id de
// visitante. El evento "Contact" que la persona disparó al tocar WhatsApp SÍ
// llevaba todo eso, pero era fire-and-forget: no quedaba guardado en ningún
// lado. Entre el Contact y la Compra de esa misma persona, el único campo en
// común era `country`.
//
// Este índice guarda el rastro del anuncio contra el teléfono, para que
// capi-venta-manual.mts pueda recuperarlo al cargar la venta.
//
// ALCANCE HONESTO: solo cubre a quien dejó su teléfono EN EL SITIO (evento
// Lead) y después terminó cerrando por WhatsApp — checkouts abandonados, el
// link de recuperación del chat tras un error o un pago pendiente. A quien
// hizo clic en un anuncio de INTERACCIÓN y fue derecho a WhatsApp sin pasar
// por la web NO lo cubre: para eso hace falta el `ctwa_clid`, que solo se
// puede capturar con la WhatsApp Business Platform API.
//
// La CLAVE es el hash SHA-256 del teléfono normalizado, no el teléfono en
// claro: así el listado del store no expone números de clientes. Como el
// hash es determinístico, la búsqueda desde la venta manual da igual.
const PHONE_INDEX_STORE = "attribution-by-phone"

// 90 días: la ventana de atribución más larga de Meta es de 28, pero una
// conversación de WhatsApp puede tardar en cerrarse y guardar de más no
// cuesta nada. Se filtra al leer (Blobs no tiene expiración nativa).
const PHONE_INDEX_TTL_MS = 90 * 24 * 60 * 60 * 1000

export type PhoneAttribution = {
  fbp?: string
  fbc?: string
  ip?: string
  userAgent?: string
  city?: string
  region?: string
  postalCode?: string
  countryCode?: string
  visitorId?: string
  capturedAt: number
}

// `phoneKey` tiene que venir ya hasheado por el caller (sha256Hex de
// normalizePhoneForHash), para no arrastrar el teléfono en claro hasta acá.
export async function savePhoneAttribution(
  phoneKey: string,
  data: PhoneAttribution,
): Promise<void> {
  try {
    const store = getStore(PHONE_INDEX_STORE)
    const previous = (await store.get(phoneKey, { type: "json" })) as PhoneAttribution | null
    // No pisar un rastro que YA tenía la cookie del clic del anuncio con uno
    // que no la tiene: la primera visita desde el anuncio es la que vale, y
    // una visita orgánica posterior de la misma persona no debe borrarla.
    if (previous?.fbc && !data.fbc) {
      await store.setJSON(phoneKey, { ...data, fbc: previous.fbc })
      return
    }
    await store.setJSON(phoneKey, data)
  } catch (err) {
    // Nunca romper el envío del evento por esto — es un índice de apoyo.
    console.error("[attribution] no se pudo guardar el índice por teléfono:", err)
  }
}

export async function getPhoneAttribution(phoneKey: string): Promise<PhoneAttribution | null> {
  try {
    const data = (await getStore(PHONE_INDEX_STORE).get(phoneKey, {
      type: "json",
    })) as PhoneAttribution | null
    if (!data) return null
    if (Date.now() - data.capturedAt > PHONE_INDEX_TTL_MS) return null
    return data
  } catch {
    return null
  }
}
