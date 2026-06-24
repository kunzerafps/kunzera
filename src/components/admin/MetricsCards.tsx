import { motion } from "framer-motion"
import { Calendar, DollarSign, Gem, TrendingUp, Zap } from "lucide-react"
import type { AdminMetrics } from "../../types/order"
import { formatARS } from "../../lib/formatters"
import { PACKS } from "../../lib/packs"

type Props = {
  metrics: AdminMetrics
  totalOrders: number
}

export default function MetricsCards({ metrics, totalOrders }: Props) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Card
        icon={<DollarSign className="w-4 h-4" />}
        label="Total vendido"
        value={formatARS(metrics.totalARS)}
        accent
      />
      <Card
        icon={<Calendar className="w-4 h-4" />}
        label="Reservas hoy"
        value={String(metrics.todayCount)}
        sub={`${totalOrders} en total`}
      />
      <Card
        icon={<Zap className="w-4 h-4" />}
        label="Platino"
        value={String(metrics.byPlan.platino || 0)}
        sub={formatARS((metrics.byPlan.platino || 0) * PACKS.platino.price)}
      />
      <Card
        icon={<Gem className="w-4 h-4" />}
        label="Diamante"
        value={String(metrics.byPlan.diamante || 0)}
        sub={formatARS((metrics.byPlan.diamante || 0) * PACKS.diamante.price)}
      />
    </div>
  )
}

function Card({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  accent?: boolean
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative rounded-2xl p-4 border ${
        accent
          ? "bg-gradient-to-br from-brand-900/40 to-black border-brand-600/50 shadow-glow-red"
          : "glass-card"
      }`}
    >
      <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-white/50 mb-2">
        {icon} {label}
      </div>
      <div
        className={`font-display font-black text-2xl md:text-3xl ${
          accent ? "text-gradient-red" : "text-white"
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-white/40 font-mono mt-1">{sub}</div>}
      {accent && <TrendingUp className="absolute top-3 right-3 w-4 h-4 text-brand-400/60" />}
    </motion.div>
  )
}
