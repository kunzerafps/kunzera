import { motion } from "framer-motion"
import { Trophy, Brain, ShieldCheck } from "lucide-react"
import { useEffect, useState } from "react"

const SLIDES = [
  { src: "/kun1.png", alt: "Ezequiel \"Kun\" Palmero", tag: null, contain: true },
  { src: "/campeon.jpg", alt: "Equipo 9z, campeones de la Logitech G Challenge", tag: "🏆 Campeones · Logitech G Challenge", contain: false },
  { src: "/9zz.jpg", alt: "Ezequiel \"Kun\" Palmero levantando el trofeo de campeón con 9z", tag: "🏆 Campeón con 9z · Counter-Strike", contain: false },
  { src: "/kun-competencia.jpg", alt: "Ezequiel \"Kun\" Palmero jugando en un evento, transmitido por DRAFT5", tag: "🎮 En competencia · DRAFT5", contain: false },
]

const WHO_CARDS = [
  {
    icon: Trophy,
    title: 'Ezequiel "Kun" Palmero',
    desc: (
      <>
        Jugué CS2 profesional en 9z, River y Coscu Army. Sé lo que es perder una ronda por un
        micro-corte — no es teoría, lo viví compitiendo. Verificalo vos mismo:{" "}
        <a
          href="https://liquipedia.net/counterstrike/KUN"
          target="_blank"
          rel="noreferrer"
          className="text-brand-400 underline underline-offset-2 hover:text-brand-300"
        >
          Liquipedia
        </a>
        ,{" "}
        <a
          href="https://www.hltv.org/player/12375/kun"
          target="_blank"
          rel="noreferrer"
          className="text-brand-400 underline underline-offset-2 hover:text-brand-300"
        >
          HLTV
        </a>{" "}
        o{" "}
        <a
          href="https://www.instagram.com/ezekunnnn"
          target="_blank"
          rel="noreferrer"
          className="text-brand-400 underline underline-offset-2 hover:text-brand-300"
        >
          Instagram @ezekunnnn
        </a>
        .
      </>
    ),
  },
  {
    icon: Brain,
    title: "Lógica, no magia",
    desc: 'No vendo "programas milagrosos". Uso las mismas configuraciones que tengo en mi propia PC, basadas en cómo funciona Windows de verdad.',
  },
  {
    icon: ShieldCheck,
    title: "Tu PC no arriesga nada",
    desc: "Te dejo ver todo lo que hago en pantalla durante la sesión. Cortás la conexión cuando quieras.",
  },
]

function Carousel() {
  const [i, setI] = useState(0)

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const id = setInterval(() => setI((v) => (v + 1) % SLIDES.length), 4000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="relative rounded-[20px] overflow-hidden border border-white/10 bg-gradient-to-br from-[#141416] to-black shadow-2xl shadow-black/50 aspect-[4/5]">
      {SLIDES.map((s, idx) => (
        <div
          key={s.src}
          className="absolute inset-0 transition-opacity duration-1000"
          style={{ opacity: idx === i ? 1 : 0 }}
        >
          {idx === 0 && (
            <div
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(ellipse at 50% 35%, rgba(255,42,42,.3) 0%, transparent 65%)",
              }}
            />
          )}
          <img
            src={s.src}
            alt={s.alt}
            className={
              s.contain
                ? "relative w-full h-full object-contain p-6"
                : "relative w-full h-full object-cover"
            }
          />
          {s.tag && (
            <div className="absolute left-3.5 bottom-3.5 bg-black/75 backdrop-blur border border-white/15 rounded-full px-3.5 py-2 text-xs font-mono text-white">
              {s.tag}
            </div>
          )}
        </div>
      ))}
      <div className="absolute bottom-4 right-3.5 flex gap-1.5 z-10">
        {SLIDES.map((_, idx) => (
          <span
            key={idx}
            className={`w-1.5 h-1.5 rounded-full transition-colors ${
              idx === i ? "bg-brand-400" : "bg-white/30"
            }`}
          />
        ))}
      </div>
    </div>
  )
}

export default function About() {
  return (
    <section id="sobre-mi" className="relative py-24 md:py-32 section-padding overflow-hidden">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-2xl mx-auto mb-16"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand-950/60 border border-brand-900 text-brand-300 text-xs font-mono uppercase tracking-widest mb-5">
            Antes de reservar
          </div>
          <h2 className="font-display font-black text-4xl md:text-5xl lg:text-6xl mb-4 leading-tight">
            ¿A quién le vas a <span className="text-gradient-red">comprar</span>?
          </h2>
          <p className="text-white/60 text-lg">Nada de empresa grande ni call center. Te atiendo yo, directo.</p>
        </motion.div>

        <div className="grid lg:grid-cols-[.85fr_1.15fr] gap-10 items-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.6 }}
          >
            <Carousel />
          </motion.div>

          <div className="flex flex-col gap-3.5">
            {WHO_CARDS.map(({ icon: Icon, title, desc }, i) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                whileHover={{ y: -4 }}
                className="glass-card rounded-2xl p-5 flex items-start gap-3.5"
              >
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-brand-500/20 to-brand-900/40 border border-brand-600/40 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4.5 h-4.5 text-brand-400" />
                </div>
                <div>
                  <div className="font-display font-bold text-white text-base mb-1">{title}</div>
                  <div className="text-white/60 text-sm leading-relaxed">{desc}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
