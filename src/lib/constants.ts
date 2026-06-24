export const WHATSAPP_NUMBER = "5493382677871"

export const WHATSAPP_MESSAGE_PLATINO =
  "Hola! Quiero reservar el pack *Platino* de optimización de PC."
export const WHATSAPP_MESSAGE_DIAMANTE =
  "Hola! Quiero reservar el pack *Diamante* de optimización de PC."
export const WHATSAPP_MESSAGE_GENERAL =
  "Hola! Quiero info sobre la optimización de PC."

export const waLink = (message: string) =>
  `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`

// ────────────────────────────────────────────────────────────
//  Apps Script / pagos
// ────────────────────────────────────────────────────────────

// Pegar aquí la URL del Web App de Apps Script después de deployar
// (ver google-apps-script/README.md)
export const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzV4aBgPzLgRKnecqmisEhJ77l_yGWiFgqip-rE1kXdesYjMKkuB-70ahsV58eXf7-KWA/exec"

// Alias de Mercado Pago donde el cliente transfiere
export const MP_ALIAS = "kunzera.mp"

// Email asociado a Binance Pay para cobrar en USDT
export const BINANCE_EMAIL = "ezepalmero@gmail.com"

// ────────────────────────────────────────────────────────────
//  Turnos
// ────────────────────────────────────────────────────────────

export const SLOT_SESSION_MIN = 20
export const SLOT_BREAK_MIN = 0
export const SLOT_STEP_MIN = SLOT_SESSION_MIN + SLOT_BREAK_MIN // 20
export const SLOT_START_HOUR = 15 // 15:00
export const SLOT_END_HOUR = 3 // 03:00 del día siguiente
export const TIMEZONE = "America/Argentina/Buenos_Aires"

// ────────────────────────────────────────────────────────────
//  Admin
// ────────────────────────────────────────────────────────────

// SHA-256 hex de "alixepero136"
export const ADMIN_PASSWORD_HASH =
  "790467bb0d4ce77ebbd225f3419c138c25730d30c32bdf8c4ed4bc2d8621639e"

// Token que el front manda al endpoint getOrders. Debe coincidir con
// la Script Property ADMIN_TOKEN del Apps Script.
export const ADMIN_SECRET_TOKEN = "1bf8f203f7d5428c88da097596f51551"

// ────────────────────────────────────────────────────────────
//  Archivos
// ────────────────────────────────────────────────────────────

export const MAX_FILE_BYTES = 6 * 1024 * 1024 // 6 MB real
export const ACCEPTED_MIME = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "application/pdf",
]
