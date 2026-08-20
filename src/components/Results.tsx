import { motion } from "framer-motion"

type Metric = {
  label: string
  optVal: string
  stdVal: string
  optPct: number
  stdPct: number
  delta: string
  deltaLabel: string
}

const METRICS: Metric[] = [
  { label: "FPS promedio", optVal: "187", stdVal: "100", optPct: 100, stdPct: 53.5, delta: "+87%", deltaLabel: "en promedio" },
  { label: "1% Lows (estabilidad)", optVal: "130", stdVal: "100", optPct: 100, stdPct: 76.9, delta: "+30%", deltaLabel: "menos caídas de FPS" },
  { label: "Ping · menos es mejor", optVal: "28ms", stdVal: "32ms", optPct: 87.5, stdPct: 100, delta: "-13%", deltaLabel: "de ping promedio" },
  { label: "Latencia de Windows · menos es mejor", optVal: "1ms", stdVal: "15ms", optPct: 6.7, stdPct: 100, delta: "-93%", deltaLabel: "de latencia del sistema" },
]

export default function Results() {
  return (
    <section id="resultados" className="relative py-24 md:py-32 section-padding">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-2xl mx-auto mb-16"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand-950/60 border border-brand-900 text-brand-300 text-xs font-mono uppercase tracking-widest mb-5">
            Resultados promedio
          </div>
          <h2 className="font-display font-black text-4xl md:text-5xl lg:text-6xl mb-4 leading-tight">
            Números <span className="text-gradient-red">reales</span>, no promesas
          </h2>
          <p className="text-white/60 text-lg">Promedio de clientes optimizados, medido en sesiones reales.</p>
        </motion.div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
          {METRICS.map((m, i) => (
            <motion.div
              key={m.label}
              initial={{ opacity: 0, y: 18 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              whileHover={{ y: -4 }}
              className="glass-card rounded-2xl p-5"
            >
              <div className="text-[11px] font-mono uppercase tracking-widest text-white/40 mb-4">
                {m.label}
              </div>
              <div className="mb-3">
                <div className="flex items-baseline justify-between text-sm mb-1.5">
                  <span className="text-white font-semibold">Optimizado</span>
                  <span className="font-mono font-bold text-white tabular-nums">{m.optVal}</span>
                </div>
                <div className="h-2 rounded-full bg-white/[0.07] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-700"
                    style={{ width: `${m.optPct}%` }}
                  />
                </div>
              </div>
              <div className="mb-3">
                <div className="flex items-baseline justify-between text-sm mb-1.5">
                  <span className="text-white/60 font-semibold">Estándar</span>
                  <span className="font-mono font-bold text-white/70 tabular-nums">{m.stdVal}</span>
                </div>
                <div className="h-2 rounded-full bg-white/[0.07] overflow-hidden">
                  <div className="h-full rounded-full bg-white/25" style={{ width: `${m.stdPct}%` }} />
                </div>
              </div>
              <div className="pt-3.5 border-t border-white/10 text-sm text-white/60 leading-relaxed">
                <b className="text-brand-400">{m.delta}</b> {m.deltaLabel}
              </div>
            </motion.div>
          ))}

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5, delay: 0.32 }}
            whileHover={{ y: -4 }}
            className="glass-card rounded-2xl p-5"
          >
            <div className="text-[11px] font-mono uppercase tracking-widest text-white/40 mb-4">Fluidez</div>
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between text-sm text-white/50">
                <span>Antes</span>
                <span className="px-2.5 py-1 rounded-full bg-white/5 text-white/50 text-xs font-semibold">
                  Con tirones
                </span>
              </div>
              <div className="flex items-center justify-between text-sm text-white/50">
                <span>Después</span>
                <span className="px-2.5 py-1 rounded-full bg-brand-950 border border-brand-900 text-brand-300 text-xs font-semibold">
                  Fluida, sin cortes
                </span>
              </div>
            </div>
            <div className="pt-3.5 mt-2.5 border-t border-white/10 text-sm text-white/60 leading-relaxed">
              La diferencia se siente jugando, no solo en un número.
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
