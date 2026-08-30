import { trackServerBackedEvent } from "./pixel"
import { firedOnceInSession, markFiredOnceInSession } from "./storage"

// "Tocó WhatsApp" — un único punto para los CUATRO botones que lo disparan:
// el flotante, el del pie de página, el link de recuperación del chat y la
// apertura del chat de reserva.
//
// Dos cosas que arregla respecto de tenerlo suelto en cada componente:
//
// 1. UN SOLO TOPE, compartido. Antes solo la apertura del chat tenía guard, y
//    era un `useRef` (o sea, por carga de página). Una misma persona podía
//    generar 3 o 4 "Contact" en la misma visita: abrir el chat, tocar el
//    flotante, tocarlo de nuevo porque parecía que no pasaba nada, y el del
//    pie. Eso infla el conteo del evento y ensucia cualquier público de
//    "gente que nos contactó". El guard vive en sessionStorage, así que
//    aguanta que el chat se desmonte y se limpia al confirmar una reserva.
//
// 2. IDENTIDAD. Los cuatro sitios mandaban `{}`, o sea el evento iba anónimo.
//    En el link de recuperación del chat (tras un error de reserva o un pago
//    pendiente) la persona YA dejó nombre y teléfono — y justamente ese
//    Contact existe para poder atribuirle después la venta que se termina
//    cerrando por WhatsApp. Mandarlo sin teléfono le sacaba a Meta lo único
//    con lo que podía unir las dos puntas.
//
// `Contact` nunca es objetivo de campaña (ver pixel.ts), así que esto no
// cambia por dónde se optimiza — mejora la calidad del dato.
export function trackContactOnce(
  placement: string,
  identity: { whatsapp?: string; nombre?: string } = {},
): void {
  if (firedOnceInSession("contact")) return
  markFiredOnceInSession("contact")
  trackServerBackedEvent("Contact", identity, { content_name: placement })
}
