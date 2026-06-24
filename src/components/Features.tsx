import { motion } from "framer-motion"
import {
  Cpu,
  MemoryStick,
  MonitorDot,
  Trash2,
  Mouse,
  Wrench,
  FileCode2,
  Shield,
} from "lucide-react"

const features = [
  {
    icon: Cpu,
    title: "CPU",
    desc: "Afinidad, prioridades, energía y programador de Windows configurados para gaming.",
  },
  {
    icon: MonitorDot,
    title: "Placa de Video",
    desc: "Drivers limpios, panel NVIDIA/AMD y tweaks de renderizado.",
  },
  {
    icon: MemoryStick,
    title: "RAM",
    desc: "Gestión de memoria, caché y timings para reducir stutters.",
  },
  {
    icon: Mouse,
    title: "Teclado & Mouse",
    desc: "Polling rate, raw input y delay al mínimo absoluto.",
  },
  {
    icon: Trash2,
    title: "Limpieza + Debloat",
    desc: "Eliminación de telemetría, basura de Windows y servicios inútiles.",
  },
  {
    icon: FileCode2,
    title: "Tweaks de Registro",
    desc: "Ediciones finas del registro para más FPS y menos input lag.",
  },
  {
    icon: Shield,
    title: "Windows 10/11",
    desc: "Scripts probados para desactivar todo lo que te está frenando.",
  },
  {
    icon: Wrench,
    title: "Finalización",
    desc: "Testeo en tiempo real y ajuste fino hasta dejar la PC perfecta.",
  },
]

export default function Features() {
  return (
    <section id="features" className="relative py-24 md:py-32 section-padding">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-2xl mx-auto mb-16"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand-950/60 border border-brand-900 text-brand-300 text-xs font-mono uppercase tracking-widest mb-5">
            Optimización 360°
          </div>
          <h2 className="font-display font-black text-4xl md:text-5xl lg:text-6xl mb-4 leading-tight">
            Todo lo que tocamos en tu <span className="text-gradient-red">PC</span>
          </h2>
          <p className="text-white/60 text-lg">
            Proceso completo: CPU, GPU, RAM, periféricos, limpieza, debloat,
            registros, BIOS y finalización con pruebas.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {features.map((f, i) => {
            const Icon = f.icon
            return (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.05 }}
                whileHover={{ y: -6 }}
                className="group relative glass-card rounded-2xl p-6 overflow-hidden"
              >
                <div className="absolute -top-20 -right-20 w-40 h-40 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(197,12,12,0.15) 0%, transparent 65%)" }} />

                <div className="relative">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-700 to-brand-950 flex items-center justify-center mb-4 shadow-glow-red group-hover:scale-110 transition">
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                  <h3 className="font-display font-bold text-xl mb-2">
                    {f.title}
                  </h3>
                  <p className="text-white/60 text-sm leading-relaxed">
                    {f.desc}
                  </p>
                </div>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
