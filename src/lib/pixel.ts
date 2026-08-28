import { randomId } from "./crypto"
import { getFbp, getFbc } from "./cookies"
import { getVisitorId } from "./visitorId"

type Fbq = (...args: unknown[]) => void

// Eventos estándar de Meta — el resto se manda con "trackCustom" (Meta tira
// un warning si le pasás un nombre desconocido por "track").
const STANDARD_META_EVENTS = new Set([
  "PageView",
  "ViewContent",
  "AddToCart",
  "AddToWishlist",
  "InitiateCheckout",
  "AddPaymentInfo",
  "Purchase",
  "Lead",
  "CompleteRegistration",
  "Contact",
  "CustomizeProduct",
  "Donate",
  "FindLocation",
  "Schedule",
  "StartTrial",
  "SubmitApplication",
  "Subscribe",
  "Search",
])

// Wrapper minimo sobre window.fbq (inyectado por el snippet del Meta Pixel
// en index.html) - evita repetir el cast inseguro en cada componente que
// necesita mandar un evento cliente-side. Si se pasa `eventId`, se manda
// como eventID para que Meta pueda deduplicar este evento del navegador
// contra su copia server-side (ver trackServerBackedEvent).
export function trackPixelEvent(
  eventName: string,
  params?: Record<string, unknown>,
  eventId?: string,
): void {
  const fbq = (window as unknown as { fbq?: Fbq }).fbq
  if (typeof fbq !== "function") return
  const method = STANDARD_META_EVENTS.has(eventName) ? "track" : "trackCustom"
  if (eventId) {
    fbq(method, eventName, params, { eventID: eventId })
  } else {
    fbq(method, eventName, params)
  }
}

type Identity = {
  whatsapp?: string
  nombre?: string
}

// Eventos de mitad de embudo que también se mandan desde el servidor. Todo
// nombre que no esté acá es ignorado por /api/capi-funnel (no queremos que
// un cliente manipulado mande "Purchase" por esa vía, que es 100%
// server-side y auditada).
const SERVER_BACKED_EVENTS = [
  "Lead",
  "InitiateCheckout",
  "ViewContent",
  "AddToCart",
  // "turno_seleccionado": señal temprana (tocó un horario), sirve para armar
  // públicos de "gente con intención". "Schedule": el turno reservado de
  // verdad (reserva confirmada), el evento que las campañas usan como objetivo.
  "turno_seleccionado",
  "Schedule",
] as const
export type ServerBackedEventName = (typeof SERVER_BACKED_EVENTS)[number]

// Dispara un evento de mitad de embudo por DOS vías con el mismo eventID:
//   1. el píxel del navegador (rápido, con la cookie _fbp)
//   2. una copia server-side (POST a /api/capi-funnel) que agrega el
//      teléfono/nombre hasheados (si los hay), el id de navegador y la
//      IP/user-agent reales — resiste bloqueadores de anuncios y Safari/iOS,
//      donde el píxel solo no llega.
// Meta une las dos por el eventID. Best-effort: si el POST falla, queda el
// evento del navegador igual que antes. `identity` es opcional: ViewContent
// y AddToCart se disparan antes de que la persona deje sus datos.
export function trackServerBackedEvent(
  eventName: ServerBackedEventName,
  identity: Identity = {},
  params?: Record<string, unknown>,
): void {
  const eventId = randomId()
  trackPixelEvent(eventName, params, eventId)

  const value =
    typeof params?.value === "number" && Number.isFinite(params.value) ? params.value : undefined
  const contentIds = Array.isArray(params?.content_ids)
    ? (params!.content_ids as unknown[]).filter((x): x is string => typeof x === "string")
    : undefined

  void fetch("/api/capi-funnel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventId,
      event: eventName,
      whatsapp: identity.whatsapp,
      nombre: identity.nombre,
      externalId: getVisitorId(),
      fbp: getFbp(),
      fbc: getFbc(),
      value,
      currency: typeof params?.currency === "string" ? params.currency : undefined,
      contentName: typeof params?.content_name === "string" ? params.content_name : undefined,
      contentIds: contentIds && contentIds.length > 0 ? contentIds : undefined,
      contentType: typeof params?.content_type === "string" ? params.content_type : undefined,
    }),
  }).catch(() => {})
}
