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
export const MP_ALIAS = "juanmarquez2026.mp"
// Titular de la cuenta — se muestra junto al alias en el paso de pago para
// dar confianza (una compra de $50–70 mil a un alias "pelado" frena).
export const MP_ALIAS_TITULAR = "Juan Enrique Marquez"

// Email asociado a Binance Pay para cobrar en USDT
export const BINANCE_EMAIL = "ezepalmero@gmail.com"

// ────────────────────────────────────────────────────────────
//  Turnos
// ────────────────────────────────────────────────────────────

export const SLOT_SESSION_MIN = 20
export const SLOT_BREAK_MIN = 0
export const SLOT_STEP_MIN = SLOT_SESSION_MIN + SLOT_BREAK_MIN // 20
export const SLOT_START_HOUR = 13 // 13:00 (primer turno)
export const SLOT_END_HOUR = 21 // 21:00 exclusivo → último turno 20:40
export const TIMEZONE = "America/Argentina/Buenos_Aires"

// ────────────────────────────────────────────────────────────
//  Admin
// ────────────────────────────────────────────────────────────

// Fallback si nunca se guardó un hash custom en la config del sitio (ver
// site-config en Blobs). Ya no se usa del lado del cliente (useAdminGate.ts
// manda la contraseña hasheada a /api/admin-login, que es quien compara
// contra esto) — solo lo leen las funciones server-side.
export const ADMIN_PASSWORD_HASH =
  "790467bb0d4ce77ebbd225f3419c138c25730d30c32bdf8c4ed4bc2d8621639e"

// Token fijo que el front manda al Apps Script (getOrders/deleteOrder/etc,
// vía appsScript.ts) — debe coincidir con la Script Property ADMIN_TOKEN
// ahí. Sigue siendo un valor estático visible en el bundle público a
// propósito: migrarlo a sesión firmada (como se hizo para facturación,
// comprobantes y config del sitio, ver adminSession.ts) requeriría tocar
// el código del Apps Script del lado de Google, que queda fuera de lo que
// se toca en este repo.
//
// ⚠️ SI SE ROTA ESTE VALOR: también hay que actualizar a mano la Script
// Property ADMIN_TOKEN en el proyecto de Google Apps Script (google-apps-
// script/Code.gs, línea con `props.setProperty('ADMIN_TOKEN', ...)`). No hay
// forma técnica de compartir este valor entre los dos sistemas — si se
// olvida el lado de Apps Script, el panel admin empieza a fallar en
// silencio (401 en getOrders/deleteOrder) sin ningún aviso.
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
