import { randomId } from "./crypto"
import { getFbp, getFbc } from "./cookies"
import { getVisitorId } from "./visitorId"

type Fbq = (...args: unknown[]) => void

// Ni el panel de administración ni los dispositivos de Eze / de quien lo
// ayuda deben generar eventos de Meta: contarlos como "visitas" mete tráfico
// interno en los públicos de remarketing y en el modelo de optimización, y
// termina haciendo que se pague por mostrar anuncios al propio equipo.
//   - `#admin` en la URL: se está abriendo el panel ahora mismo.
//   - localStorage `kz_staff`: timestamp del último login al panel en este
//     dispositivo (lo setea useAdminGate) — cubre navegar el sitio normal
//     después. Vence a los STAFF_TTL_MS para que abrir el panel una vez en la
//     PC de un cliente no la deje sin tracking para siempre.
//   - `?kz_track=1` en la URL: escotilla — borra la marca de este dispositivo
//     y fuerza tracking normal (para volver a testear el sitio real).
// La MISMA lógica está duplicada, más chica, en el script inline de
// index.html (ese HTML es estático y no puede importar de acá).
const STAFF_TTL_MS = 90 * 24 * 60 * 60 * 1000

export function isStaffSession(): boolean {
  try {
    if (typeof window === "undefined") return false
    if (/[?&]kz_track=1(?:&|$)/.test(window.location.search)) {
      try {
        localStorage.removeItem("kz_staff")
      } catch {
        /* noop */
      }
      return false
    }
    if (window.location.hash === "#admin") return true
    const raw = localStorage.getItem("kz_staff")
    if (!raw) return false
    // Compat con el valor viejo "1" (pre-timestamp): sigue valiendo hasta que
    // el próximo login lo reescriba como timestamp.
    if (raw === "1") return true
    const ts = Number(raw)
    return Number.isFinite(ts) && Date.now() - ts < STAFF_TTL_MS
  } catch {
    return false
  }
}

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
  if (isStaffSession()) return
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
  // públicos de "gente con intención". ("Schedule" — la reserva confirmada,
  // que es objetivo de campaña — ya NO se dispara desde el navegador: es 100%
  // server-side, junto con el Purchase, ver mp-webhook.mts /
  // capi-confirmar-pago.mts. Antes salía de acá al volver de Mercado Pago,
  // antes de que el pago estuviera confirmado.)
  "turno_seleccionado",
  // "Contact": tocó el botón de WhatsApp. NUNCA se usa como objetivo de
  // campaña (el objetivo siempre es Purchase) — la copia server-side existe
  // sólo para que lleve el id de navegador / _fbp / _fbc / IP, y así una
  // compra real que después se cierra por WhatsApp (y se carga a mano) se
  // pueda atribuir al anuncio en vez de caer en "vino de la nada". El píxel
  // del navegador solo se pierde en iOS/Safari/adblock.
  "Contact",
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
  if (isStaffSession()) return
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
