import { Cpu, MemoryStick, Zap, MonitorDot, HardDrive, Mouse, Keyboard, Wifi, Thermometer, Trash2, Sparkles, Gauge } from "lucide-react"

const items = [
  { icon: Cpu, label: "CPU Tuning" },
  { icon: MonitorDot, label: "GPU Optimization" },
  { icon: MemoryStick, label: "RAM Timings" },
  { icon: Zap, label: "Advanced BIOS" },
  { icon: HardDrive, label: "Debloater" },
  { icon: Trash2, label: "Limpieza Profunda" },
  { icon: Mouse, label: "Mouse Delay Fix" },
  { icon: Keyboard, label: "Keyboard Polling" },
  { icon: Wifi, label: "Network Tweaks" },
  { icon: Thermometer, label: "Temp Control" },
  { icon: Sparkles, label: "Registry Tweaks" },
  { icon: Gauge, label: "Input Lag -68%" },
]

export default function Marquee() {
  return (
    <section className="relative py-10 border-y border-brand-900/50 bg-black/40">
      <div className="overflow-hidden relative">
        <div className="absolute left-0 top-0 bottom-0 w-32 bg-gradient-to-r from-[#070003] to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-32 bg-gradient-to-l from-[#070003] to-transparent z-10 pointer-events-none" />
        <div className="marquee gap-12 px-6">
          {[...items, ...items].map((item, i) => {
            const Icon = item.icon
            return (
              <div
                key={i}
                className="flex items-center gap-3 whitespace-nowrap text-white/60 hover:text-brand-400 transition"
              >
                <Icon className="w-5 h-5 text-brand-500" />
                <span className="font-mono text-sm uppercase tracking-wider">
                  {item.label}
                </span>
                <span className="text-brand-900">•</span>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
