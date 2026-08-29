import type { Pack } from "../types/order"

export type OpenChatDetail = {
  pack?: Pack
  startReservation?: boolean
  // true cuando el chat lo abre un deep-link de anuncio (no un clic de la
  // persona). Sirve para NO disparar el pixel "Contact" de Meta en una
  // apertura automática — si no, todo el tráfico del anuncio contaría como
  // "contacto" sin que nadie hiciera nada y Meta pierde la señal real.
  auto?: boolean
}

export const CHAT_OPEN_EVENT = "kunzera:open-chat"

export function openChat(detail: OpenChatDetail = {}) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CHAT_OPEN_EVENT, { detail }))
  }
}

export function listenOpenChat(handler: (d: OpenChatDetail) => void): () => void {
  const listener = (e: Event) => {
    handler((e as CustomEvent<OpenChatDetail>).detail || {})
  }
  window.addEventListener(CHAT_OPEN_EVENT, listener)
  return () => window.removeEventListener(CHAT_OPEN_EVENT, listener)
}

// ── Señal "la persona ya se comprometió con una reserva" ──
// true = eligió un pack o entró al formulario de reserva. El botón flotante
// de WhatsApp la escucha para esconderse en ese momento y no desviar a
// alguien que está por comprar (ver WhatsAppFloat.tsx). ChatBot la emite en
// cada cambio de estado del chat.
export const CHAT_PROGRESS_EVENT = "kunzera:chat-progress"

export function emitChatProgress(inFunnel: boolean) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CHAT_PROGRESS_EVENT, { detail: { inFunnel } }))
  }
}

export function listenChatProgress(handler: (inFunnel: boolean) => void): () => void {
  const listener = (e: Event) => handler(!!(e as CustomEvent<{ inFunnel?: boolean }>).detail?.inFunnel)
  window.addEventListener(CHAT_PROGRESS_EVENT, listener)
  return () => window.removeEventListener(CHAT_PROGRESS_EVENT, listener)
}
