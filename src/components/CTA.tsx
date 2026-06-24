import { motion } from "framer-motion"
import { ArrowRight, Zap } from "lucide-react"
import { openChat } from "../lib/chatBus"

export default function CTA() {
  return (
    <section className="relative py-24 md:py-32 section-padding">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
          className="relative rounded-3xl overflow-hidden"
        >
          <div className="absolute inset-0 bg-gradient-to-br from-brand-800 via-brand-950 to-black" />
          <div className="absolute inset-0 bg-grid-red opacity-40" style={{ backgroundSize: "40px 40px" }} />
          <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(255,42,42,0.18) 0%, transparent 65%)" }} />
          <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(197,12,12,0.22) 0%, transparent 65%)" }} />

          <div className="relative p-10 md:p-16 text-center">
            <motion.div
              initial={{ scale: 0 }}
              whileInView={{ scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2, type: "spring" }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand-950/60 border border-brand-500/40 text-brand-300 text-xs font-mono uppercase tracking-widest mb-6"
            >
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Disponible hoy
            </motion.div>

            <h2 className="font-display font-black text-4xl md:text-6xl lg:text-7xl mb-6 leading-tight heading-glow">
              Listo para <br />
              <span className="text-gradient-red">romperla</span>?
            </h2>
            <p className="text-white/70 text-lg md:text-xl max-w-xl mx-auto mb-10">
              Reservá tu turno online en 1 minuto y en menos de 2 horas tenés tu
              PC volando.
            </p>

            <div className="flex flex-wrap gap-4 justify-center">
              <button
                onClick={() => openChat({ startReservation: true })}
                className="btn-primary group text-base"
              >
                <Zap className="w-5 h-5" fill="currentColor" />
                Reservar turno
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
              </button>
              <a href="#pricing" className="btn-ghost">
                Ver packs de nuevo
              </a>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
