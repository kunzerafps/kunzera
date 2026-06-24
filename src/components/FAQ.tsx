import { motion, AnimatePresence } from "framer-motion"
import { Plus } from "lucide-react"
import { useState } from "react"

const faqs = [
  {
    q: "¿Es seguro? ¿Me van a romper la PC?",
    a: "No. Antes de tocar nada, se crea un punto de restauración y backup del registro. Todos los tweaks son reversibles y probados en +6000 PCs.",
  },
  {
    q: "¿Cuánto dura la sesión?",
    a: "Platino: 15 min aprox. Diamante: 30 min aprox. Son sesiones directas por acceso remoto; el tiempo puede variar un poco según el estado inicial del equipo y la conexión, pero la idea es dejártelo listo rápido y sin vueltas.",
  },
  {
    q: "¿Tengo que formatear?",
    a: "No, no hace falta formatear. La optimización se aplica sobre tu Windows actual sin borrar nada: tus programas, juegos y archivos quedan intactos.",
  },
  {
    q: "¿Sirve para todos los juegos?",
    a: "Sí. La optimización es sobre la PC en general, no sobre un juego puntual: mejora el rendimiento en cualquier juego y también en programas de edición.",
  },
  {
    q: "¿Puedo volver atrás si no me gusta?",
    a: "Sí. Se deja un punto de restauración para que puedas revertir todo si querés. Pero no conozco a nadie que lo haya hecho 😄",
  },
  {
    q: "¿Me sirve si tengo una PC vieja?",
    a: "Totalmente. En PCs más humildes el antes/después es aún más notorio. Se gana fluidez, boot más rápido y menos freezeos.",
  },
  {
    q: "¿Qué pasa con el overclock? ¿Es riesgoso?",
    a: "El overclock del pack Diamante es opcional y se hace dentro de parámetros seguros, con testeo de estabilidad y monitoreo de temperaturas.",
  },
  {
    q: "¿Qué métodos de pago aceptás?",
    a: "Transferencia bancaria, MercadoPago y criptomonedas. El pago se hace antes de arrancar la sesión.",
  },
  {
    q: "¿Incluye soporte después?",
    a: "Sí, tenés soporte por WhatsApp por si aparece cualquier duda o detalle post-optimización.",
  },
]

export default function FAQ() {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <section id="faq" className="relative py-24 md:py-32 section-padding">
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-2xl mx-auto mb-16"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand-950/60 border border-brand-900 text-brand-300 text-xs font-mono uppercase tracking-widest mb-5">
            FAQ
          </div>
          <h2 className="font-display font-black text-4xl md:text-5xl lg:text-6xl mb-4 leading-tight">
            Preguntas <span className="text-gradient-red">frecuentes</span>
          </h2>
        </motion.div>

        <div className="space-y-3">
          {faqs.map((item, i) => {
            const isOpen = open === i
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.05 }}
                className={`glass-card rounded-xl overflow-hidden transition ${
                  isOpen ? "border-brand-600/50" : ""
                }`}
              >
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left hover:bg-white/5 transition"
                >
                  <span className="font-semibold text-white text-base md:text-lg">
                    {item.q}
                  </span>
                  <motion.div
                    animate={{ rotate: isOpen ? 45 : 0 }}
                    transition={{ duration: 0.3 }}
                    className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-950 border border-brand-900 flex items-center justify-center"
                  >
                    <Plus className="w-4 h-4 text-brand-400" />
                  </motion.div>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: "easeInOut" }}
                    >
                      <div className="px-6 pb-5 text-white/70 leading-relaxed">
                        {item.a}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
