import { motion } from "framer-motion"
import { MessageCircle, Monitor, Settings, Rocket } from "lucide-react"
import { SiAnydesk, SiDiscord, SiWhatsapp } from "react-icons/si"

const steps = [
  {
    n: "01",
    icon: MessageCircle,
    title: "Reservá por WhatsApp",
    desc: "Elegís el pack y coordinamos día y hora. Te paso instrucciones previas.",
  },
  {
    n: "02",
    icon: Monitor,
    title: "Conectamos por Anydesk",
    desc: "Me conecto de forma segura a tu PC. Vos ves todo lo que hago en tiempo real.",
  },
  {
    n: "03",
    icon: Settings,
    title: "Optimización completa",
    desc: "Aplico los +30 tweaks, limpieza, debloat y ajustes según tu pack.",
  },
  {
    n: "04",
    icon: Rocket,
    title: "Testeo y entrega",
    desc: "Probamos juntos, medimos FPS y dejamos todo funcionando al 100%.",
  },
]

const tools = [
  { icon: SiAnydesk, label: "Anydesk", sub: "PC" },
  { icon: SiDiscord, label: "Discord", sub: "Llamada" },
  { icon: SiWhatsapp, label: "WhatsApp", sub: "Celular" },
]

export default function HowItWorks() {
  return (
    <section id="how" className="relative py-24 md:py-32 section-padding">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-2xl mx-auto mb-16"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand-950/60 border border-brand-900 text-brand-300 text-xs font-mono uppercase tracking-widest mb-5">
            Proceso
          </div>
          <h2 className="font-display font-black text-4xl md:text-5xl lg:text-6xl mb-4 leading-tight">
            ¿Cómo <span className="text-gradient-red">funciona</span>?
          </h2>
          <p className="text-white/60 text-lg">
            100% remoto, 100% transparente. Todo el proceso es online, sin moverte de tu casa.
          </p>
        </motion.div>

        {/* Steps */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5 mb-16">
          {steps.map((s, i) => {
            const Icon = s.icon
            return (
              <motion.div
                key={s.n}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="relative"
              >
                <div className="glass-card rounded-2xl p-6 h-full relative overflow-hidden group">
                  <div className="absolute top-4 right-4 font-display font-black text-5xl text-brand-900/50 group-hover:text-brand-700/60 transition">
                    {s.n}
                  </div>
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-600 to-brand-900 flex items-center justify-center mb-4 shadow-glow-red">
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="font-display font-bold text-xl mb-2">
                    {s.title}
                  </h3>
                  <p className="text-white/60 text-sm leading-relaxed">
                    {s.desc}
                  </p>
                </div>
                {i < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-1/2 -right-3 w-6 h-px bg-gradient-to-r from-brand-700 to-transparent" />
                )}
              </motion.div>
            )
          })}
        </div>

        {/* Requirements */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="relative glass-card rounded-2xl p-8 md:p-10 overflow-hidden"
        >
          <div className="absolute -top-20 -right-20 w-60 h-60 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(162,15,15,0.18) 0%, transparent 65%)" }} />

          <div className="relative grid md:grid-cols-[auto_1fr] gap-8 items-center">
            <div>
              <div className="text-xs font-mono text-brand-400 uppercase tracking-widest mb-2">
                Requisitos
              </div>
              <h3 className="font-display font-bold text-2xl md:text-3xl">
                Lo que necesitás
              </h3>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {tools.map((t) => {
                const Icon = t.icon
                return (
                  <div
                    key={t.label}
                    className="flex flex-col items-center justify-center p-5 rounded-xl bg-black/40 border border-brand-900/40 hover:border-brand-500/50 transition group"
                  >
                    <Icon className="w-8 h-8 text-brand-400 group-hover:text-brand-300 mb-2 transition" />
                    <div className="font-bold text-sm">{t.label}</div>
                    <div className="text-white/40 text-xs font-mono uppercase">
                      {t.sub}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
