import { motion } from "framer-motion"
import {
  Cpu,
  Gauge,
  Rocket,
  Sparkles,
  Trophy,
  Users,
  Wrench,
  Zap,
} from "lucide-react"

type TimelineItem = {
  year: string
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  accent: string
  image?: string
  stat?: { value: string; label: string }
}

const items: TimelineItem[] = [
  {
    year: "2014",
    title: "Los inicios",
    description:
      "Mi primera PC gamer. Empecé rompiendo y armando de nuevo Windows hasta entender cómo funciona cada tweak.",
    icon: Cpu,
    accent: "from-brand-700 to-brand-950",
    stat: { value: "10 años", label: "haciendo tweaks" },
  },
  {
    year: "2017",
    title: "Primera optimización seria",
    description:
      "Descubrí que podía bajar el input lag hasta 68%. Empecé a documentar cada cambio y a medirlo con benchmarks.",
    icon: Gauge,
    accent: "from-brand-600 to-brand-900",
    stat: { value: "-68%", label: "input lag" },
  },
  {
    year: "2020",
    title: "Primeros clientes pagos",
    description:
      "Lo que antes era un hobby se convirtió en un servicio. Anydesk + método probado = resultados replicables.",
    icon: Wrench,
    accent: "from-brand-500 to-brand-800",
    stat: { value: "+500", label: "PCs el primer año" },
  },
  {
    year: "2023",
    title: "Nace Kunzera",
    description:
      "Se forma la marca. Streamers, profesionales del esports y gamers casuales empiezan a recomendar el servicio.",
    icon: Rocket,
    accent: "from-brand-500 to-brand-700",
    stat: { value: "+1.500", label: "clientes" },
  },
  {
    year: "2025",
    title: "+6000 PCs optimizadas",
    description:
      "BIOS, overclock, curvas de voltaje, tuning fino de XMP/EXPO y scripts propios. El método Kunzera es un estándar.",
    icon: Trophy,
    accent: "from-brand-400 to-brand-700",
    stat: { value: "+6.000", label: "PCs" },
  },
  {
    year: "Hoy",
    title: "Tu turno",
    description:
      "Cada PC es distinta. Conectamos por Anydesk, aplicamos +30 tweaks y dejamos tu equipo volando.",
    icon: Zap,
    accent: "from-brand-400 to-brand-600",
    stat: { value: "240 FPS", label: "avg" },
  },
]

export default function About() {
  return (
    <section id="sobre-mi" className="relative py-24 md:py-32 section-padding overflow-hidden">
      <div className="max-w-5xl mx-auto relative">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16 md:mb-20"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand-950/60 border border-brand-900 text-brand-300 text-xs font-mono uppercase tracking-widest mb-5">
            <Sparkles className="w-3 h-3" />
            Sobre mí
          </div>
          <h2 className="font-display font-black text-4xl md:text-5xl lg:text-6xl mb-4 leading-tight">
            El camino hasta <span className="text-gradient-red">Kunzera</span>
          </h2>
          <p className="text-white/60 text-lg max-w-2xl mx-auto">
            De armar mi primera PC a optimizar +6000 equipos. Cada línea de tiempo es
            una lección que hoy se aplica a tu setup.
          </p>
        </motion.div>

        {/* Timeline */}
        <div className="relative">
          {/* Línea central vertical. Wrapper estático posiciona; motion.div interno solo anima scaleY
             (evitamos que framer-motion pise el -translate-x-1/2 de Tailwind). */}
          <div
            className="absolute top-0 bottom-0 left-6 md:left-1/2 -translate-x-1/2 w-px"
            aria-hidden
          >
            <motion.div
              initial={{ scaleY: 0 }}
              whileInView={{ scaleY: 1 }}
              viewport={{ once: true, amount: 0.05 }}
              transition={{ duration: 1.2, ease: "easeOut" }}
              style={{ transformOrigin: "top" }}
              className="w-full h-full bg-gradient-to-b from-brand-500/60 via-brand-700/40 to-transparent"
            />
          </div>

          {/* Items */}
          <div className="space-y-16 md:space-y-24">
            {items.map((item, i) => (
              <TimelineNode key={item.year + item.title} item={item} index={i} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function TimelineNode({ item, index }: { item: TimelineItem; index: number }) {
  const Icon = item.icon
  const isLeft = index % 2 === 0

  return (
    <div className="relative grid md:grid-cols-2 md:gap-10">
      {/* Dot en la línea — wrapper estático para el posicionamiento,
         motion.div interno solo anima scale/opacity (así Tailwind translate no se pisa). */}
      <div className="absolute left-6 md:left-1/2 top-8 md:top-10 -translate-x-1/2 z-10">
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          whileInView={{ scale: 1, opacity: 1 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="relative"
        >
          <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${item.accent} flex items-center justify-center shadow-glow-red border-2 border-[#070003]`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
          <div className={`absolute inset-0 rounded-full bg-gradient-to-br ${item.accent} blur-xl opacity-40 -z-10`} />
        </motion.div>
      </div>

      {/* Card (alternando lado en desktop, siempre a la derecha en mobile) */}
      <div
        className={`
          pl-20 md:pl-0
          ${isLeft
            ? "md:col-start-1 md:pr-12 md:text-right"
            : "md:col-start-2 md:pl-12 md:text-left"}
        `}
      >
        <motion.article
          initial={{ opacity: 0, x: isLeft ? -40 : 40, y: 20 }}
          whileInView={{ opacity: 1, x: 0, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="relative"
        >
          {/* Visual (placeholder con gradient + icon) */}
          <motion.div
            whileHover={{ scale: 1.02 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
            className={`relative aspect-[16/10] rounded-2xl overflow-hidden border border-brand-900/40 mb-4 bg-gradient-to-br ${item.accent}`}
          >
            {item.image ? (
              <img
                src={item.image}
                alt={item.title}
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
                <div
                  className="absolute inset-0 opacity-25"
                  style={{
                    backgroundImage:
                      "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
                    backgroundSize: "24px 24px",
                  }}
                />
                <Icon className="w-16 h-16 md:w-20 md:h-20 mb-3 opacity-90 relative z-10" />
                {item.stat && (
                  <div className="relative z-10 text-center">
                    <div className="font-display font-black text-3xl md:text-4xl drop-shadow-lg">
                      {item.stat.value}
                    </div>
                    <div className="text-[10px] font-mono uppercase tracking-widest opacity-80">
                      {item.stat.label}
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* Corner tag con el año */}
            <div className="absolute top-3 left-3 px-2 py-1 rounded-md bg-black/50 backdrop-blur text-[10px] font-mono uppercase tracking-widest text-white/90 border border-white/10">
              {item.year}
            </div>
          </motion.div>

          {/* Text */}
          <div className={isLeft ? "md:text-right" : "md:text-left"}>
            <div className="flex items-baseline gap-2 mb-1.5 md:justify-start md:flex-wrap"
              style={{ justifyContent: isLeft ? undefined : undefined }}
            >
              <span className="text-xs font-mono text-brand-400 uppercase tracking-widest">
                {item.year}
              </span>
              <span className="text-white/20 text-xs">·</span>
              <h3 className="font-display font-bold text-white text-xl md:text-2xl">
                {item.title}
              </h3>
            </div>
            <p className="text-white/60 text-sm md:text-base leading-relaxed">
              {item.description}
            </p>
          </div>
        </motion.article>
      </div>
    </div>
  )
}
