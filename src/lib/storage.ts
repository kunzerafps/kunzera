import type { FlowState, OrderDraft } from "../types/order"

const DRAFT_KEY = "kz_order_draft_v1"
const DRAFT_TTL_MS = 24 * 3600 * 1000

type StoredDraft = {
  draft: OrderDraft
  state: FlowState
  savedAt: number
}

// Estados desde los que tiene sentido ofrecer "Retomar" un pedido sin
// terminar. Tiene que estar sincronizado con los `case` del reducer
// (chatFlow.ts) y con FlowRenderer: si un draft viejo quedó en un estado que
// ya no existe / no se puede retomar (ej. un paso "askDiscord" de una versión
// anterior), loadDraft() lo descarta en vez de ofrecer un "Retomar" muerto.
const RESUMABLE_STATES: FlowState[] = [
  "planPicked",
  "askName",
  "askWhatsapp",
  "askEmail",
  "pickSlot",
  "review",
  "payment",
  "uploadProof",
]

export function canResume(state: FlowState): boolean {
  return RESUMABLE_STATES.includes(state)
}

export function saveDraft(draft: OrderDraft, state: FlowState): void {
  try {
    if (!canResume(state)) {
      clearDraft()
      return
    }
    const { file: _file, ...draftWithoutFile } = draft
    const payload: StoredDraft = {
      draft: draftWithoutFile,
      state,
      savedAt: Date.now(),
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(payload))
  } catch {
    // localStorage quota o modo privado — ignoramos
  }
}

export function loadDraft(): StoredDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredDraft
    if (!parsed || !parsed.savedAt) return null
    if (Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
      clearDraft()
      return null
    }
    if (!canResume(parsed.state)) {
      // Draft de una versión anterior en un estado que ya no se puede retomar
      // → descartarlo, para no mostrar un banner "Retomar" que no lleva a nada.
      clearDraft()
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // noop
  }
}

const ADMIN_KEY = "kz_admin_ok"

// Guarda el token de sesión que devuelve /api/admin-login (firmado del lado
// del servidor, con vencimiento) — reemplaza al viejo flag booleano "1" de
// cuando la sesión se decidía enteramente del lado del cliente.
export function setAdminAuthed(token: string): void {
  try {
    sessionStorage.setItem(ADMIN_KEY, token)
  } catch {
    // noop
  }
}

export function isAdminAuthed(): boolean {
  return getAdminToken() !== null
}

export function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_KEY)
  } catch {
    return null
  }
}

export function clearAdminAuth(): void {
  try {
    sessionStorage.removeItem(ADMIN_KEY)
  } catch {
    // noop
  }
}

// Guard "una vez por sesión de navegador" para el evento turno_seleccionado
// (ver FlowRenderer). Vive en sessionStorage, no en un ref de React, porque
// el chat se desmonta al cerrarse y un ref se reiniciaría. Se limpia cuando
// una reserva se confirma, para que un intento nuevo en la misma sesión
// vuelva a mandar la señal de intención.
const TURNO_SEL_KEY = "kz_turno_sel_fired"

export function turnoSelAlreadyFired(): boolean {
  try {
    return sessionStorage.getItem(TURNO_SEL_KEY) === "1"
  } catch {
    return false
  }
}

export function markTurnoSelFired(): void {
  try {
    sessionStorage.setItem(TURNO_SEL_KEY, "1")
  } catch {
    // modo privado — en el peor caso se manda alguna vez de más
  }
}

export function clearTurnoSelFired(): void {
  try {
    sessionStorage.removeItem(TURNO_SEL_KEY)
  } catch {
    // noop
  }
}

// Guard "una vez por sesión de navegador" para Lead: si el cliente vuelve
// atrás y avanza de nuevo (corrigió el teléfono), el evento se disparaba otra
// vez e inflaba la cuenta / ensuciaba el aprendizaje de Meta. Se limpia al
// confirmar una reserva, igual que turno_seleccionado.
const FIRED_ONCE_KEYS = {
  lead: "kz_lead_fired",
} as const

type FiredOnceEvent = keyof typeof FIRED_ONCE_KEYS

export function firedOnceInSession(ev: FiredOnceEvent): boolean {
  try {
    return sessionStorage.getItem(FIRED_ONCE_KEYS[ev]) === "1"
  } catch {
    return false
  }
}

export function markFiredOnceInSession(ev: FiredOnceEvent): void {
  try {
    sessionStorage.setItem(FIRED_ONCE_KEYS[ev], "1")
  } catch {
    // modo privado — en el peor caso se manda alguna vez de más
  }
}

// AddToCart guarda QUÉ pack se disparó, no un simple "ya salió". Dos razones:
//
// 1. Antes el guard era booleano y quedaba pegado al primer pack elegido: el
//    que comparaba Platino y terminaba comprando Diamante le mandaba a Meta
//    "agregó Platino $50.000" y después "compró Diamante $70.000". La
//    optimización por valor aprendía un precio que no era el de la venta.
// 2. El evento pasó a dispararse desde el reducer (ver ChatBot.tsx), que es
//    el único punto por el que pasan los CUATRO caminos de elegir pack: el
//    chip del chat, el botón "Reservar" de la sección de precios, los
//    deep-links de anuncios (/reservar/<pack>, ?pack=) y el texto libre.
//    Antes solo el chip lo disparaba, así que el tráfico pago con link
//    directo al pack —el de más intención— nunca lo mandaba.
const ADD_TO_CART_PACK_KEY = "kz_addtocart_pack"

export function addToCartFiredForPack(): string | null {
  try {
    return sessionStorage.getItem(ADD_TO_CART_PACK_KEY)
  } catch {
    return null
  }
}

export function markAddToCartFiredForPack(pack: string): void {
  try {
    sessionStorage.setItem(ADD_TO_CART_PACK_KEY, pack)
  } catch {
    // modo privado — en el peor caso se manda alguna vez de más
  }
}

export function clearFiredOnceInSession(): void {
  try {
    for (const key of Object.values(FIRED_ONCE_KEYS)) {
      sessionStorage.removeItem(key)
    }
    sessionStorage.removeItem(ADD_TO_CART_PACK_KEY)
  } catch {
    // noop
  }
}

const SUBMIT_COOLDOWN_KEY = "kz_last_submit"
const SUBMIT_COOLDOWN_MS = 30 * 1000

export function canSubmit(): boolean {
  try {
    const raw = localStorage.getItem(SUBMIT_COOLDOWN_KEY)
    if (!raw) return true
    const last = parseInt(raw, 10) || 0
    return Date.now() - last > SUBMIT_COOLDOWN_MS
  } catch {
    return true
  }
}

export function markSubmitted(): void {
  try {
    localStorage.setItem(SUBMIT_COOLDOWN_KEY, String(Date.now()))
  } catch {
    // noop
  }
}
