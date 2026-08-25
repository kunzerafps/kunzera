import { motion } from "framer-motion"
import { SiWhatsapp } from "react-icons/si"
import { waLink, WHATSAPP_MESSAGE_GENERAL } from "../lib/constants"
import { trackPixelEvent } from "../lib/pixel"

export default function WhatsAppFloat() {
  return (
    <motion.a
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay: 1.5, type: "spring", stiffness: 200 }}
      href={waLink(WHATSAPP_MESSAGE_GENERAL)}
      target="_blank"
      rel="noreferrer"
      onClick={() => trackPixelEvent("Contact", { content_name: "whatsapp_float" })}
      // bottom-left, no bottom-right: el lanzador del chat y el panel de chat
      // compacto ya ocupan esa esquina (bottom-24/bottom-6 right-6) — poner
      // este botón ahí lo taparía cuando el chat está abierto.
      className="fixed bottom-6 left-6 z-40 group"
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
