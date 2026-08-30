import { useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import { SiWhatsapp } from "react-icons/si"
import { waLink, WHATSAPP_FLOAT_MESSAGE } from "../lib/constants"
import { withAdReturnLink } from "../lib/deeplink"
import { listenChatProgress } from "../lib/chatBus"
import { trackContactOnce } from "../lib/contactEvent"

export default function WhatsAppFloat() {
  // Se esconde cuando la persona ya eligió un pack o entró al flujo de reserva
  // en el chat (ChatBot emite esta señal) — a esa altura queremos que TERMINE
  // la compra en el sitio, no desviarla a una charla manual.
  const [inFunnel, setInFunnel] = useState(false)
  useEffect(() => listenChatProgress(setInFunnel), [])

  // withAdReturnLink le suma al mensaje el link de regreso con fbclid+utm
  // SOLO cuando la visita vino de un anuncio (si no, el mensaje queda igual).
  // Este boton es la salida a WhatsApp mas usada del sitio y era el unico de
  // los tres que NO lo llevaba, justo el caso que mas plata mueve: clic en
  // anuncio -> toca WhatsApp -> cierra la venta por ahi. Sin el link de
  // regreso esa compra le llega a Meta sin el dato del anuncio que la trajo.
  // Se calcula una sola vez al montar: el fbclid ya esta en la URL desde la
  // carga de la pagina.
  const href = useMemo(() => waLink(withAdReturnLink(WHATSAPP_FLOAT_MESSAGE)), [])

  return (
    <motion.a
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: inFunnel ? 0 : 1, opacity: inFunnel ? 0 : 1 }}
      transition={{ type: "spring", stiffness: 220, damping: 20 }}
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-hidden={inFunnel}
      tabIndex={inFunnel ? -1 : 0}
      style={{ pointerEvents: inFunnel ? "none" : "auto" }}
      onClick={() => trackContactOnce("whatsapp_float")}
      // bottom-left, no bottom-right: el lanzador del chat y el panel de chat
      // compacto ya ocupan esa esquina. En celular sube un poco (bottom-20)
      // para no chocar con la barra fija de planes (StickyPlansBar).
      className="fixed bottom-20 left-6 z-40 group md:bottom-6"
      aria-label="Contactar por WhatsApp"
    >
      <div className="w-12 h-12 rounded-full bg-green-600 flex items-center justify-center shadow-lg shadow-green-900/40 hover:scale-105 transition">
        <SiWhatsapp className="w-6 h-6 text-white" />
      </div>
    </motion.a>
  )
}
