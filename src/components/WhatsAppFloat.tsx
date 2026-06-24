import { motion } from "framer-motion"
import { SiWhatsapp } from "react-icons/si"
import { waLink, WHATSAPP_MESSAGE_GENERAL } from "../lib/constants"

export default function WhatsAppFloat() {
  return (
    <motion.a
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ delay: 1.5, type: "spring", stiffness: 200 }}
      href={waLink(WHATSAPP_MESSAGE_GENERAL)}
      target="_blank"
      rel="noreferrer"
      className="fixed bottom-24 right-6 z-40 group"
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
