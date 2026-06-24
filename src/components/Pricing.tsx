import { motion } from "framer-motion"
import { Check, Gem, Zap, ArrowRight, Crown } from "lucide-react"
import { useMemo } from "react"
import { PACKS } from "../lib/packs"
import { openChat } from "../lib/chatBus"
import type { Pack } from "../types/order"
import { useSiteConfig } from "../hooks/useWaMessages"

const PACK_FEATURES = {
  platino: {
    headline: "+FPS · -Input Lag",
    features: [
      "Limpieza Profunda del Sistema — remoción de archivos residuales y caché para un sistema más ágil.",
      "Windows Ultra-Debloat — eliminación de procesos nativos innecesarios para reducir la carga sobre el procesador.",
      "Zero-Telemetry — bloqueo de servicios de rastreo de Microsoft, priorizando privacidad y ahorro de recursos.",
      "Hardware Max-Performance — seteo de alto rendimiento para que CPU, GPU y RAM trabajen sin restricciones.",
      "Reducción de Input Lag — ajuste de latencia en periféricos para una respuesta inmediata y precisa del mouse.",
      "Tweaks de Registro Avanzados — modificaciones de bajo nivel para eliminar stuttering y asegurar fluidez visual.",
      "Network Stability Pro — configuración de red orientada a estabilizar el ping y eliminar la pérdida de paquetes (loss).",
    ],
  },
  diamante: {
    headline: "Máximo rendimiento",
    features: [
      "Incluye todo el Pack Platino.",
      "Configuración Profesional de BIOS — ajuste de bajo nivel para eliminar limitaciones y ahorros de energía de fábrica.",
      "Undervolt de Precisión — maximizamos la frecuencia del procesador bajando el voltaje: más FPS con menores temperaturas.",
      "Overclock Seguro y Estable — incremento de potencia bajo parámetros estrictos de seguridad para no degradar componentes.",
      "Control Térmico Garantizado — calibración de curvas de ventilación para prevenir calor excesivo y proteger el hardware.",
      "Core-Priority Mapping — forzamos al procesador a priorizar tu juego por encima de cualquier otra tarea.",
    ],
  },
} as const

export default function Pricing() {
  const { prices } = useSiteConfig()

  const packs = useMemo(
    () => [
      {
        name: PACKS.platino.name,
        tier: PACKS.platino.id,
        priceArs: prices.platino.ars,
        priceUsd: prices.platino.usd,
        icon: Zap,
        highlight: false,
        tagline: PACKS.platino.tagline,
        headline: PACK_FEATURES.platino.headline,
        features: PACK_FEATURES.platino.features,
      },
      {
        name: PACKS.diamante.name,
        tier: PACKS.diamante.id,
        priceArs: prices.diamante.ars,
        priceUsd: prices.diamante.usd,
        icon: Gem,
        highlight: true,
        tagline: PACKS.diamante.tagline,
        headline: PACK_FEATURES.diamante.headline,
        features: PACK_FEATURES.diamante.features,
      },
    ],
    [prices],
  )

  return (
    <section id="pricing" className="relative py-24 md:py-32 section-padding">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-2xl mx-auto mb-16"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand-950/60 border border-brand-900 text-brand-300 text-xs font-mono uppercase tracking-widest mb-5">
            Packs Disponibles
          </div>
          <h2 className="font-display font-black text-4xl md:text-5xl lg:text-6xl mb-4 leading-tight">
            Elegí tu <span className="text-gradient-red">plan</span>
          </h2>
          <p className="text-white/60 text-lg">
            Dos packs pensados para distintos niveles de optimización. Sin letra
            chica, sin extras escondidos.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
          {packs.map((pack, i) => {
            const Icon = pack.icon
            return (
              <motion.div
                key={pack.name}
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: i * 0.15 }}
                whileHover={{ y: -8 }}
                className={`relative rounded-3xl overflow-hidden flex flex-col h-full ${
                  pack.highlight
                    ? "bg-gradient-to-b from-brand-900/40 to-black border-2 border-brand-600 shadow-glow-red-lg"
                    : "glass-card"
                }`}
              >
                {pack.highlight && (
                  <>
                    <div className="absolute top-0 right-0 px-4 py-1.5 rounded-bl-xl bg-gradient-to-r from-brand-500 to-brand-700 text-white text-xs font-bold uppercase tracking-widest flex items-center gap-1.5">
                      <Crown className="w-3.5 h-3.5" />
                      Más elegido
                    </div>
                    <div className="absolute -top-40 -right-40 w-[400px] h-[400px] rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(239,19,19,0.18) 0%, transparent 65%)" }} />
                  </>
                )}

                <div className="relative p-8 md:p-10 flex flex-col flex-1">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-6">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <div
                          className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                            pack.highlight
                              ? "bg-gradient-to-br from-brand-500 to-brand-800 shadow-glow-red"
                              : "bg-gradient-to-br from-white/10 to-white/5"
                          }`}
                        >
                          <Icon className="w-6 h-6 text-white" />
                        </div>
                        <h3 className="font-display font-black text-3xl">
                          {pack.name}
                        </h3>
                      </div>
                      <p className="text-white/50 text-sm">{pack.tagline}</p>
                    </div>
                  </div>

                  <div
                    className={`inline-block px-3 py-1 rounded-md text-xs font-mono uppercase tracking-widest mb-6 ${
                      pack.highlight
                        ? "bg-brand-500/20 text-brand-300 border border-brand-500/40"
                        : "bg-white/5 text-white/60 border border-white/10"
                    }`}
                  >
                    {pack.headline}
                  </div>

                  {/* Price */}
                  <div className="mb-8">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-display font-black text-5xl md:text-6xl text-white">
                        ${pack.priceArs.toLocaleString("es-AR")}
                      </span>
                      <span className="text-white/40 text-sm">ARS</span>
                      <span className="text-white/30 text-sm font-mono">
                        · USD ${pack.priceUsd.toLocaleString("es-AR")}
                      </span>
                    </div>
                    <div className="text-white/40 text-sm mt-1">
                      Pago único · Sin mensualidades
                    </div>
                  </div>

                  {/* Features */}
                  <ul className="space-y-3 mb-8 flex-1">
                    {pack.features.map((feat) => (
                      <li key={feat} className="flex items-start gap-3">
                        <div
                          className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                            pack.highlight
                              ? "bg-brand-500"
                              : "bg-white/10"
                          }`}
                        >
                          <Check className="w-3 h-3 text-white" strokeWidth={3} />
                        </div>
                        <span className="text-white/80 text-sm leading-relaxed">
                          {feat}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <button
                    onClick={() => openChat({ pack: pack.tier as Pack })}
                    className={`mt-auto flex items-center justify-center gap-2 w-full py-4 rounded-xl font-semibold transition-all group ${
                      pack.highlight
                        ? "bg-gradient-to-r from-brand-500 to-brand-700 hover:from-brand-400 hover:to-brand-600 shadow-lg shadow-brand-900/50"
                        : "bg-white/5 hover:bg-white/10 border border-white/10 hover:border-brand-500/60"
                    }`}
                  >
                    Reservar {pack.name}
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
                  </button>
                </div>
              </motion.div>
            )
          })}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5 }}
          className="text-center text-white/40 text-sm mt-10 font-mono"
        >
          * Transferencia bancaria, MercadoPago o Crypto. Consultá otros métodos por WhatsApp.
        </motion.p>
      </div>
    </section>
  )
}
