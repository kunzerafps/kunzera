import { motion } from "framer-motion"
import { useState } from "react"
import { formatARS } from "../../lib/formatters"

type Point = { date: string; count: number; monto: number }

type Props = {
  last7: Point[]
  last30: Point[]
}

type Range = "7" | "30"

export default function SalesChart({ last7, last30 }: Props) {
  const [range, setRange] = useState<Range>("7")
  const data = range === "7" ? last7 : last30
  const max = Math.max(1, ...data.map((d) => d.monto))

  return (
    <div className="glass-card rounded-2xl p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-display font-bold text-white">Ventas por día</h3>
          <p className="text-xs text-white/40 font-mono">
            Últimos {range} días · Total: {formatARS(data.reduce((a, d) => a + d.monto, 0))}
          </p>
        </div>
        <div className="flex gap-1">
          {(["7", "30"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1 text-xs rounded-full transition ${
                range === r
                  ? "bg-brand-500 text-white"
                  : "bg-brand-950/80 text-brand-200 border border-brand-700/50 hover:border-brand-500"
              }`}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-end gap-1 h-40">
        {data.map((d, i) => {
          const heightPct = (d.monto / max) * 100
          return (
            <motion.div
              key={d.date}
              initial={{ height: 0 }}
              animate={{ height: `${heightPct}%` }}
              transition={{ duration: 0.4, delay: i * 0.02 }}
              className="relative flex-1 min-w-[8px] rounded-t bg-gradient-to-t from-brand-700 to-brand-400 hover:from-brand-600 hover:to-brand-300 group"
              title={`${d.date}: ${formatARS(d.monto)} (${d.count})`}
            >
              {d.monto > 0 && (
                <div className="absolute -top-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition text-[10px] font-mono text-white whitespace-nowrap bg-black/80 px-1.5 py-0.5 rounded">
                  {formatARS(d.monto)}
                </div>
              )}
            </motion.div>
          )
        })}
      </div>

      <div className="mt-2 flex justify-between text-[9px] text-white/30 font-mono">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  )
}
