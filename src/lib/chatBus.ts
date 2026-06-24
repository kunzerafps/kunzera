import type { Pack } from "../types/order"

export type OpenChatDetail = {
  pack?: Pack
  startReservation?: boolean
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
