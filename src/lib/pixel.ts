import { randomId } from "./crypto"
import { getFbp, getFbc } from "./cookies"
import { getVisitorId } from "./visitorId"

type Fbq = (...args: unknown[]) => void

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
  if (eventId) {
    fbq("track", eventName, params, { eventID: eventId })
  } else {
    fbq("track", eventName, params)
  }
}

type Identity = {
  whatsapp?: string
  nombre?: string
}

// Dispara un evento de mitad de embudo (Lead, InitiateCheckout) por DOS
// vías con el mismo eventID:
//   1. el píxel del navegador (rápido, con la cookie _fbp)
//   2. una copia server-side (POST a /api/capi-funnel) que agrega el
//      teléfono y el nombre hasheados + IP/user-agent reales — resiste
//      bloqueadores de anuncios y Safari/iOS, donde el píxel solo no llega.
// Meta une las dos por el eventID. Best-effort: si el POST falla, queda el
// evento del navegador igual que antes.
export function trackServerBackedEvent(
  eventName: "Lead" | "InitiateCheckout",
  identity: Identity,
  params?: Record<string, unknown>,
): void {
  const eventId = randomId()
  trackPixelEvent(eventName, params, eventId)

  const value =
    typeof params?.value === "number" && Number.isFinite(params.value) ? params.value : undefined

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
    }),
  }).catch(() => {})
}
