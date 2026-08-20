import { motion, AnimatePresence } from "framer-motion"
import { Plus } from "lucide-react"
import { useState } from "react"

const faqs = [
  {
    q: "¿Es seguro? ¿Me van a romper la PC?",
    a: "No. Antes de tocar nada creo un punto de restauración y backup del registro. Uso los mismos tweaks que ya probé en +6000 PCs, todos reversibles.",
  },
  {
    q: "¿Cuánto dura la sesión?",
    a: "Platino: unos 15 min. Diamante: unos 30 min. Puede variar un poco según cómo esté tu PC y la conexión.",
  },
  {
    q: "¿Tengo que formatear?",
    a: "No hace falta. Trabajo sobre tu Windows actual sin borrar nada: tus programas, juegos y archivos quedan intactos.",
  },
  {
    q: "¿Sirve para todos los juegos?",
    a: "Sí. Optimizo la PC en general, no un juego puntual, así que mejora el rendimiento en cualquier juego y también en programas de edición.",
  },
  {
    q: "¿Incluye configurar mi procesador, placa de video, RAM, mouse y teclado?",
    a: "Sí, los dos packs incluyen todo: procesador, placa de video, RAM, mouse, teclado y cualquier otro periférico que tengas conectado. No hay nada que se cobre aparte.",
  },
  {
    q: "¿Me sirve si tengo una PC vieja?",
    a: "Totalmente. En PCs más humildes el antes/después se nota todavía más: ganás fluidez, arranque más rápido y menos freezes.",
  },
  {
    q: "¿Puedo volver atrás si no me gusta?",
    a: "Sí, dejo un punto de restauración para que puedas revertir todo si querés. Nunca me pasó que alguien lo haga 😄",
  },
  {
    q: "¿Funciona en Mac?",
    a: "No, es específico para Windows. Si tenés Mac no puedo ayudarte con esto.",
  },
  {
    q: "¿Funciona en notebooks/laptops gamer?",
    a: "Sí, funciona igual que en una PC de escritorio.",
  },
  {
    q: "¿Qué días trabajás?",
    a: "Todos los días, incluidos fines de semana, con turnos de 13 a 21hs que elegís vos mismo en la web. Si necesitás algo fuera de ese horario, escribime por WhatsApp y lo vemos.",
  },
  {
    q: "¿Qué métodos de pago aceptás?",
    a: "Te acepto transferencia bancaria, Mercado Pago (dinero en cuenta o tarjeta) o Binance (USDT). El pago se hace antes de arrancar la sesión.",
  },
  {
    q: "¿Incluye soporte después?",
    a: "Sí, quedás con mi WhatsApp de 13 a 21hs por si te surge cualquier duda o detalle después de la optimización — y muchas veces contesto fuera de ese horario también, tratando de ayudar.",
  },
  {
    q: "¿Qué pasa con mis datos durante la sesión remota?",
    a: "Solo toco configuraciones del sistema (registro, servicios, BIOS). Ves la pantalla todo el tiempo, así que sabés exactamente qué estoy haciendo en cada paso.",
  },
  {
    q: "¿Por qué pagar esto si hay tutoriales gratis en YouTube?",
    a: "Podés intentarlo vos, pero la mayoría de esos tutoriales son genéricos y no siempre le sirven a tu PC específica. Yo reviso tu equipo en particular, aplico lo que realmente le hace bien y te dejo todo probado y andando, sin que tengas que arriesgarte a tocar algo que no conocés.",
  },
  {
    q: "¿Cómo sé qué pack me conviene?",
    a: "Contame qué PC tenés y qué juegos jugás por WhatsApp antes de reservar, y te digo cuál te conviene. Si tenés dudas, arrancar con Platino siempre es una apuesta segura.",
  },
  {
    q: "Si más adelante actualizo Windows o los drivers, ¿se pierde la optimización?",
    a: "Una actualización grande puede tocar alguna config puntual, pero no se pierde todo el trabajo. Si notás que algo cambió después de actualizar, escribime y lo vemos.",
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
                transition={{ duration: 0.4, delay: i * 0.03 }}
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
