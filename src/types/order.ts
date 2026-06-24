export type Pack = "platino" | "diamante"

export type PackInfo = {
  id: Pack
  name: string
  price: number
  tagline: string
  emoji: string
}

export type FlowState =
  | "idle"
  | "greeting"
  | "exploring"
  | "planPicked"
  | "askName"
  | "askWhatsapp"
  | "askDiscord"
  | "pickSlot"
  | "review"
  | "payment"
  | "uploadProof"
  | "submitting"
  | "confirmed"
  | "error"

export type OrderDraft = {
  pack?: Pack
  monto?: number
  nombre?: string
  whatsapp?: string
  discord?: string
  turno?: string
  file?: {
    base64: string
    mime: string
    name: string
    size: number
  }
  idempotencyKey?: string
}

export type Order = {
  timestamp: string
  nombre: string
  whatsapp: string
  discord: string
  plan: Pack
  monto: number
  turno: string
  comprobante: string
  estado: string
  idempotencykey?: string
}

export type Slot = {
  iso: string
  label: string
  dayKey: string
  hour: string
  taken: boolean
}

export type AdminMetrics = {
  totalARS: number
  todayCount: number
  byPlan: Record<Pack, number>
  last7Days: { date: string; count: number; monto: number }[]
  last30Days: { date: string; count: number; monto: number }[]
}

export type ChatMessage = {
  id: number
  from: "bot" | "user"
  text: string
  chips?: { label: string; payload: string }[]
  link?: { label: string; href: string }
  variant?: "success" | "error" | "default"
}

export type FlowEvent =
  | { type: "OPEN" }
  | { type: "CLOSE" }
  | { type: "SELECT_CHIP"; payload: string; label: string }
  | { type: "FREE_TEXT"; text: string }
  | { type: "PICK_PACK"; pack: Pack }
  | { type: "START_RESERVATION" }
  | { type: "SET_NAME"; value: string }
  | { type: "SET_WHATSAPP"; value: string }
  | { type: "SET_DISCORD"; value: string }
  | { type: "PICK_SLOT"; slotIso: string }
  | { type: "CONFIRM_REVIEW" }
  | { type: "CONFIRM_PAYMENT" }
  | { type: "UPLOAD_FILE"; file: NonNullable<OrderDraft["file"]> }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_OK"; fileUrl: string }
  | { type: "SUBMIT_ERR"; error: string }
  | { type: "RESET" }
  | { type: "BACK" }
  | { type: "HYDRATE"; draft: OrderDraft; state: FlowState }
