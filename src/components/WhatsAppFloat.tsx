import { useMemo } from "react"
import { motion } from "framer-motion"
import { SiWhatsapp } from "react-icons/si"
import { waLink, WHATSAPP_FLOAT_MESSAGE } from "../lib/constants"
import { withAdReturnLink } from "../lib/deeplink"
import { trackPixelEvent } from "../lib/pixel"

export default function WhatsAppFloat() {
  // Si la visita vino de un anuncio (fbclid/utm), withAdReturnLink() le suma
  // al final del mensaje pre-escrito un link de regreso que vuelve a llevar
  // esos parametros: cuando la persona lo abre desde el chat de WhatsApp
  // —tipico: en otro navegador, sin la cookie `_fbc`— index.html la
  // reconstruye y la compra sigue atribuyendose al anuncio. Sin anuncio de
  // origen, el mensaje queda igual que siempre.
  const href = useMemo(() => waLink(withAdReturnLink(WHATSAPP_FLOAT_MESSAGE)), [])

  return (
    <motion.a
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay: 1.5, type: "spring", stiffness: 200 }}
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={() => trackPixelEvent("Contact", { content_name: "whatsapp_float" })}
      // bottom-left, no bottom-right: el lanzador del chat y el panel de chat
      // compacto ya ocupan esa esquina (bottom-24/bottom-6 right-6) — poner
      // este botón ahí lo taparía cuando el chat está abierto.
      // En celular sube un poco (bottom-20) para no chocar con la barra fija
      // de planes (StickyPlansBar); en escritorio vuelve a bottom-6.
      className="fixed bottom-20 left-6 z-40 group md:bottom-6"
      aria-label="Contactar por WhatsApp"
    >
      <motion.div
        animate={{
          boxShadow: [
            "0 0 0 0 rgba(34, 197, 94, 0.5)",
            "0 0 0 20px rgba(34, 197, 94, 0)",
          ],
        }}
        transition={{ duration: 1.8, repeat: Infinity }}
        className="rounded-full"
      >
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-green-500 to-green-700 flex items-center justify-center shadow-2xl shadow-green-900/50 hover:scale-110 transition">
          <SiWhatsapp className="w-7 h-7 text-white" />
        </div>
      </motion.div>
    </motion.a>
  )
}
