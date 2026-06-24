import type { FlowState, OrderDraft } from "../types/order"

const DRAFT_KEY = "kz_order_draft_v1"
const DRAFT_TTL_MS = 24 * 3600 * 1000

type StoredDraft = {
  draft: OrderDraft
  state: FlowState
  savedAt: number
}

const RESUMABLE_STATES: FlowState[] = [
  "planPicked",
  "askName",
  "askWhatsapp",
  "askDiscord",
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

export function setAdminAuthed(): void {
  try {
    sessionStorage.setItem(ADMIN_KEY, "1")
  } catch {
    // noop
  }
}

export function isAdminAuthed(): boolean {
  try {
    return sessionStorage.getItem(ADMIN_KEY) === "1"
  } catch {
    return false
  }
}

export function clearAdminAuth(): void {
  try {
    sessionStorage.removeItem(ADMIN_KEY)
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
