export const WHATSAPP_NUMBER = "5493382677871"

export const WHATSAPP_MESSAGE_PLATINO =
  "Hola! Quiero reservar el pack *Platino* de optimización de PC."
export const WHATSAPP_MESSAGE_DIAMANTE =
  "Hola! Quiero reservar el pack *Diamante* de optimización de PC."
export const WHATSAPP_MESSAGE_GENERAL =
  "Hola! Quiero info sobre la optimización de PC."

// Mensaje que queda pre-escrito al tocar el botón flotante de WhatsApp de la
// web (WhatsAppFloat.tsx). Antes abría el chat vacío y la persona no recibía
// ninguna info. Trae todo lo clave + empuja a auto-reservar en el sitio.
//
// SIN EMOJIS a propósito: los emojis "grandes" (astral plane) que viajan en
// un link wa.me se rompen en WhatsApp de escritorio/web (se ven como
// cuadraditos). Los símbolos de acá (» → ·) sí sobreviven en todas las
// plataformas. Los *asteriscos* son negrita de WhatsApp: no se ven, la app
// los convierte. OJO: WhatsApp NO autoenvía — la persona toca "enviar".
export const WHATSAPP_FLOAT_MESSAGE = [
  "» ¡Hola! Gracias por escribir. *Para reservar no tenés que esperar mi respuesta* — lo hacés vos en el momento, en kunzera.com, en 2 minutos.",
  "",
  "*CÓMO RESERVÁS*",
  "» Entrás a kunzera.com, elegís tu pack y elegís vos el día y la hora que mejor te queden.",
  "» Turnos todos los días de *13 a 21h*.",
  "» Pagás por transferencia, Mercado Pago o Binance (USDT), subís el comprobante en la misma web y tu turno queda confirmado al toque.",
  "",
  "*LOS PACKS*",
  "» *PLATINO $50.000* → te dejo el Windows fino de punta a punta: limpieza a fondo, apago procesos que corren de gusto, CPU/placa de video/RAM al máximo sin los límites de fábrica, mouse y teclado sin demora y conexión estable. Más FPS y menos input lag.",
  "» *DIAMANTE $70.000* → hago toda la optimización de Windows del plan Platino (limpieza a fondo, apago procesos, CPU/placa de video/RAM al máximo, mouse y teclado sin demora, conexión estable) y además entro al BIOS, donde Windows no te deja llegar. Es el salto de FPS más grande y te deja el rendimiento parejo aunque juegues horas, sin caídas a mitad de partida. Lo máximo que se le puede sacar a tu PC — es el que más eligen.",
  "",
  "*EL DÍA DEL TURNO*",
  "» Unos minutos antes te escribo por acá y arrancamos juntos.",
  "» Me conecto por AnyDesk (te paso el link) y ves todo lo que hago en tu pantalla, en vivo.",
  "» Antes de tocar nada hago un punto de restauración y backup del registro. Si algo no te cierra, te lo dejo como estaba — tu PC siempre segura.",
  "» No abro nada personal tuyo. En 20 minutos más o menos ya estás jugando distinto.",
  "",
  "*LO QUE NECESITÁS*",
  "» Tu PC prendida, buena conexión y estar disponible en el horario que elegiste. Nada más.",
  "",
  "» Ya lo hice en *+6000 PCs*. Cuando quieras elegís tu turno en kunzera.com — te espero.",
].join("\n")

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
