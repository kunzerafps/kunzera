import { motion } from "framer-motion"
import { ArrowRight, Trophy, Brain, ShieldCheck } from "lucide-react"
import { openChat } from "../lib/chatBus"

export default function Hero() {
  return (
    <section className="relative pt-32 pb-20 md:pt-40 md:pb-28 section-padding overflow-hidden">
      {/* Animated scanline */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-brand-500/40 to-transparent animate-scan" />
      </div>

      <div className="max-w-7xl mx-auto relative">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left content */}
          <div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand-950/60 border border-brand-900 text-brand-300 text-xs font-mono uppercase tracking-widest mb-6"
            >
              <span className="w-2 h-2 rounded-full bg-brand-500 animate-pulse" />
              Windows Tweaks · Advanced BIOS
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="font-display font-black text-5xl md:text-6xl lg:text-7xl leading-[1.05] tracking-tight mb-6"
            >
              Exprimí cada <br />
              <span className="text-gradient-red heading-glow">FPS</span> de tu{" "}
              <span className="relative inline-block">
                PC
                <motion.span
                  initial={{ width: 0 }}
                  animate={{ width: "100%" }}
                  transition={{ delay: 1, duration: 0.8 }}
                  className="absolute -bottom-2 left-0 h-1 bg-gradient-to-r from-brand-500 to-transparent"
                />
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="text-white/70 text-lg md:text-xl max-w-xl mb-8 leading-relaxed"
            >
              Optimización profesional y remota. Más de <b className="text-white">30 tweaks</b>,
              tuning de BIOS y overclock para dejar tu equipo volando. Hecho
              por un especialista con <b className="text-brand-400">+6000 clientes</b>.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="flex flex-wrap gap-4 mb-10"
            >
              <button
                onClick={() => openChat({ startReservation: true })}
                className="btn-primary group"
              >
                Reservar turno
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
              </button>
              <a href="#pricing" className="btn-ghost">
                Ver packs
              </a>
            </motion.div>

          </div>

          {/* Right: animated visual */}
          <HeroVisual />
        </div>

        <WhyMe />
      </div>
    </section>
  )
}

function WhyMe() {
  const items = [
    {
      icon: Trophy,
      title: "Experiencia Real",
      desc: "Pro Player de CS2. Sé lo que es perder una ronda por un micro-corte.",
    },
    {
      icon: Brain,
      title: "Lógica, no magia",
      desc: "Sin “programas milagrosos”. Registros y configs basados en cómo funciona Windows.",
    },
    {
      icon: ShieldCheck,
      title: "Seguridad",
      desc: "Optimizaciones probadas que no comprometen la estabilidad de tu PC.",
    },
  ]
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6 }}
      className="mt-0"
    >
      <div className="text-center mb-5">
        <h3 className="font-display font-black text-2xl md:text-3xl">
          ¿Por qué <span className="text-gradient-red">elegirme</span>?
        </h3>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        {items.map(({ icon: Icon, title, desc }) => (
          <div
            key={title}
            className="glass-card rounded-xl p-5 flex items-start gap-3"
          >
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-500/20 to-brand-900/40 border border-brand-600/40 flex items-center justify-center flex-shrink-0">
              <Icon className="w-4 h-4 text-brand-400" />
            </div>
            <div>
              <div className="font-semibold text-white text-sm md:text-base mb-0.5">
                {title}
              </div>
              <div className="text-white/60 text-sm leading-relaxed">
                {desc}
              </div>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

function HeroVisual() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.8, delay: 0.3 }}
      className="relative w-full max-w-[440px] sm:max-w-[560px] lg:max-w-[720px] mx-auto aspect-square"
    >
      {/* Aura rojo radial detrás del chico — suave, solo atmósfera */}
      <div
        className="absolute inset-[-10%] pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 50% 55%, rgba(239,19,19,0.28) 0%, rgba(239,19,19,0.08) 30%, transparent 60%)",
        }}
        aria-hidden
      />
      <div
        className="absolute inset-[10%] pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 50% 60%, rgba(255,42,42,0.18) 0%, transparent 55%)",
        }}
        aria-hidden
      />

      {/* Imagen PNG del chico, sin marco, sin borde, sin filter */}
      <img
        src="/kun.png"
        alt="Kun · Fundador de Kunzera"
        loading="eager"
        className="relative z-10 w-full h-full object-contain select-none pointer-events-none"
        draggable={false}
      />
    </motion.div>
  )
}

