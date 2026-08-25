import { motion } from "framer-motion"
import { ArrowRight, Check } from "lucide-react"
import { useEffect, useState } from "react"
import { openChat } from "../lib/chatBus"

const BENEFIT_TAGS = ["Menos tirones", "Menos input lag", "Balas que pegan", "Conocé la PC que compraste"]

export default function Hero() {
  return (
    <section id="hero" className="relative pt-32 pb-20 md:pt-40 md:pb-28 section-padding overflow-hidden">
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

            {/* Sin animación de entrada a propósito: es el elemento más grande
                de la primera pantalla (LCP) — cualquier delay acá retrasa
                directamente cuánto tarda en verse contenido real en mobile/
                conexiones lentas, justo cuando llega alguien recién clickeado
                desde un anuncio. */}
            <h1 className="font-display font-black text-5xl md:text-6xl lg:text-7xl leading-[1.05] tracking-tight mb-6">
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
            </h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="text-white/70 text-lg md:text-xl max-w-xl mb-6 leading-relaxed"
            >
              Optimizo tu PC a fondo, desde WINDOWS hasta BIOS, con más de{" "}
              <b className="text-white">800 ajustes</b>, 100% remoto. Ya lo hice en{" "}
              <b className="text-brand-400">+6000 PCs</b> y sé exactamente qué mueve la aguja en FPS.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="flex flex-wrap gap-2.5 mb-8"
            >
              {BENEFIT_TAGS.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1.5 text-sm text-white/70 bg-white/5 border border-white/10 px-3.5 py-1.5 rounded-full"
                >
                  <Check className="w-3.5 h-3.5 text-brand-400" strokeWidth={3} />
                  {tag}
                </span>
              ))}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="flex flex-col items-start gap-3 mb-2"
            >
              <div className="flex flex-wrap gap-4">
                <a href="#pricing" className="btn-ghost">
                  Ver packs
                </a>
                <button
                  onClick={() => openChat({ startReservation: true })}
                  className="btn-primary group"
                >
                  Reservar turno
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
                </button>
              </div>
              <span className="text-xs font-mono text-white/40 flex items-center gap-1.5">
                ★ Sin letra chica, te lo explico yo mismo · Punto de restauración incluido
              </span>
            </motion.div>
          </div>

          {/* Right: FPS proof card */}
          <ProofCard />
        </div>
      </div>
    </section>
  )
}

function ProofCard() {
  const [opt, setOpt] = useState(120)

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduced) {
      setOpt(224)
      return
    }
    const t = setTimeout(() => {
      const start = performance.now()
      const dur = 1100
      const from = 120
      const to = 224
      function step(ts: number) {
        const p = Math.min((ts - start) / dur, 1)
        const eased = 1 - Math.pow(1 - p, 3)
        setOpt(Math.round(from + (to - from) * eased))
        if (p < 1) requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    }, 400)
    return () => clearTimeout(t)
  }, [])

  const stdPct = (120 / 224) * 100
  const optPct = (opt / 224) * 100

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.8, delay: 0.3 }}
      className="relative rounded-[22px] p-7 border border-white/10 bg-gradient-to-br from-[#141416] to-black shadow-2xl shadow-black/50"
    >
      <div className="flex items-center justify-between mb-5">
        <span className="text-[11px] font-mono uppercase tracking-widest text-white/40">
          Resultado promedio · clientes reales
        </span>
        <span className="flex items-center gap-1.5 text-[11px] font-mono text-brand-400">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
          En vivo
        </span>
      </div>

      <div className="flex items-baseline justify-between mb-4">
        <span className="text-[11px] font-mono uppercase tracking-widest text-white/40">FPS promedio</span>
        <span className="text-[11px] font-mono uppercase tracking-widest text-white/40">antes / después</span>
      </div>

      <div className="mb-3.5">
        <div className="flex items-baseline justify-between text-sm mb-1.5">
          <span className="text-white font-semibold">Optimizado</span>
          <span className="font-mono font-bold text-white tabular-nums">{opt}</span>
        </div>
        <div className="h-2 rounded-full bg-white/[0.07] overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-700 transition-[width] duration-1000"
            style={{ width: `${optPct}%` }}
          />
        </div>
      </div>
      <div className="mb-4">
        <div className="flex items-baseline justify-between text-sm mb-1.5">
          <span className="text-white/60 font-semibold">Estándar</span>
          <span className="font-mono font-bold text-white/70 tabular-nums">120</span>
        </div>
        <div className="h-2 rounded-full bg-white/[0.07] overflow-hidden">
          <div className="h-full rounded-full bg-white/25" style={{ width: `${stdPct}%` }} />
        </div>
      </div>

      <div className="pt-4 border-t border-white/10 text-sm text-white/60 leading-relaxed">
        Mejora de rendimiento: <b className="text-brand-400">+87%</b> — promedio real de clientes optimizados.
      </div>
    </motion.div>
  )
}
