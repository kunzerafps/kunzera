import { motion } from "framer-motion"
import { Star, Quote } from "lucide-react"

const testimonials = [
  {
    name: "Tomás R.",
    game: "Valorant · Fortnite",
    text: "Pasé de 180 a 340 FPS en Valorant. Se nota clarísimo la mejora en el input lag, parece otra PC.",
    rating: 5,
    specs: "i5 12400F · RTX 3060",
  },
  {
    name: "Lucía M.",
    game: "Apex · CS2",
    text: "Ya no tengo stutters en Apex. La diferencia con el antes/después es enorme. 100% recomendado.",
    rating: 5,
    specs: "Ryzen 5 5600 · RX 6650 XT",
  },
  {
    name: "Federico G.",
    game: "Warzone",
    text: "Me hizo el pack Diamante con overclock, la PC vuela. Atención re piola y todo explicado paso a paso.",
    rating: 5,
    specs: "i7 13700K · RTX 4070",
  },
  {
    name: "Marcos P.",
    game: "Rocket League",
    text: "Bajó la temperatura del CPU 10 grados y subí el FPS promedio. Reservé para mi hermano también.",
    rating: 5,
    specs: "Ryzen 7 5800X · RTX 3070",
  },
  {
    name: "Camila T.",
    game: "League of Legends",
    text: "Muy profesional. Me explicó todo lo que hacía. Windows quedó impecable, limpio y volando.",
    rating: 5,
    specs: "i5 11400F · GTX 1660",
  },
  {
    name: "Santiago D.",
    game: "FiveM · GTA V",
    text: "Tenía 30 FPS en FiveM, ahora 120+. No lo podía creer. Tipo copado y proceso re rápido.",
    rating: 5,
    specs: "Ryzen 5 3600 · RTX 2060",
  },
]

export default function Testimonials() {
  return (
    <section className="relative py-24 md:py-32 section-padding">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-2xl mx-auto mb-16"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand-950/60 border border-brand-900 text-brand-300 text-xs font-mono uppercase tracking-widest mb-5">
            Clientes reales
          </div>
          <h2 className="font-display font-black text-4xl md:text-5xl lg:text-6xl mb-4 leading-tight">
            +6000 PCs <span className="text-gradient-red">optimizadas</span>
          </h2>
          <p className="text-white/60 text-lg">
            Lo que dicen los que ya probaron el servicio.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {testimonials.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: (i % 3) * 0.1 }}
              whileHover={{ y: -4 }}
              className="relative glass-card rounded-2xl p-6 overflow-hidden group"
            >
              <Quote className="absolute top-4 right-4 w-10 h-10 text-brand-900/60 group-hover:text-brand-700/70 transition" />

              <div className="flex gap-0.5 mb-4">
                {Array.from({ length: t.rating }).map((_, idx) => (
                  <Star
                    key={idx}
                    className="w-4 h-4 fill-brand-500 text-brand-500"
                  />
                ))}
              </div>

              <p className="text-white/80 leading-relaxed mb-5 relative">
                {t.text}
              </p>

              <div className="flex items-center gap-3 pt-4 border-t border-white/5">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-600 to-brand-900 flex items-center justify-center font-bold text-white">
                  {t.name.charAt(0)}
                </div>
                <div>
                  <div className="font-semibold text-sm">{t.name}</div>
                  <div className="text-white/40 text-xs font-mono">
                    {t.specs}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
