import { motion } from "framer-motion"
import { ExternalLink, Search } from "lucide-react"
import { useMemo, useState } from "react"
import type { Order } from "../../types/order"
import { formatARS, formatDateAR, formatSlotLabel, isToday } from "../../lib/formatters"
import { comprobanteUrl } from "../../lib/comprobante"

type Props = {
  orders: Order[]
  highlightToday?: boolean
  onRowClick?: (order: Order) => void
}

type Filter = "all" | "today" | "platino" | "diamante"

export default function OrdersTable({ orders, highlightToday = true, onRowClick }: Props) {
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("all")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return orders
      .filter((o) => {
        if (filter === "today" && !isToday(o.turno)) return false
        if (filter === "platino" && o.plan !== "platino") return false
        if (filter === "diamante" && o.plan !== "diamante") return false
        if (!q) return true
        return (
          String(o.nombre ?? "").toLowerCase().includes(q) ||
          String(o.whatsapp ?? "").toLowerCase().includes(q) ||
          String(o.discord ?? "").toLowerCase().includes(q)
        )
      })
      .sort((a, b) => new Date(b.turno).getTime() - new Date(a.turno).getTime())
  }, [orders, filter, query])

  return (
    <div className="glass-card rounded-2xl p-4 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, WhatsApp o Discord…"
            className="w-full bg-white/5 border border-white/10 focus:border-brand-500/60 focus:bg-white/10 outline-none rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder:text-white/30"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {(["all", "today", "platino", "diamante"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap transition ${
                filter === f
                  ? "bg-brand-500 text-white border border-brand-400"
                  : "bg-brand-950/80 text-brand-200 border border-brand-700/50 hover:border-brand-500"
              }`}
            >
              {labelFor(f)}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-white/40 text-sm">
          {orders.length === 0 ? "No hay reservas aún" : "No coincide con el filtro"}
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 md:mx-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] font-mono uppercase tracking-widest text-white/40 border-b border-white/5">
                <th className="text-left py-2 px-4 md:px-2">Turno</th>
                <th className="text-left py-2 px-2">Nombre</th>
                <th className="text-left py-2 px-2 hidden sm:table-cell">Contacto</th>
                <th className="text-left py-2 px-2">Plan</th>
                <th className="text-right py-2 px-2">Monto</th>
                <th className="text-right py-2 px-4 md:px-2">Comprobante</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o, i) => {
                const today = highlightToday && isToday(o.turno)
                const atendido = String(o.estado || "").toLowerCase() === "atendido"
                return (
                  <motion.tr
                    key={`${o.timestamp}-${i}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.02 }}
                    onClick={() => onRowClick?.(o)}
                    className={`border-b ${
                      atendido
                        ? "bg-green-500/10 border-green-500/20 hover:bg-green-500/15"
                        : today
                        ? "bg-brand-500/5 border-white/5 hover:bg-brand-500/10"
                        : "border-white/5 hover:bg-white/5"
                    } ${onRowClick ? "cursor-pointer" : ""}`}
                  >
                    <td className="py-3 px-4 md:px-2 whitespace-nowrap">
                      <div className="text-white">{formatSlotLabel(o.turno)}</div>
                      <div className="text-[10px] text-white/30 font-mono">
                        {formatDateAR(o.timestamp)}
                      </div>
                    </td>
                    <td className="py-3 px-2 text-white font-medium">{o.nombre}</td>
                    <td className="py-3 px-2 text-white/70 hidden sm:table-cell text-xs">
                      <div>{o.whatsapp}</div>
                      <div className="text-white/40">{o.discord}</div>
                    </td>
                    <td className="py-3 px-2">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-mono uppercase ${
                          o.plan === "diamante"
                            ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                            : "bg-brand-500/20 text-brand-300 border border-brand-500/30"
                        }`}
                      >
                        {o.plan}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-right font-mono text-white">
                      {formatARS(Number(o.monto) || 0)}
                    </td>
                    <td className="py-3 px-4 md:px-2 text-right">
                      <ComprobanteCell order={o} />
                    </td>
                  </motion.tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ComprobanteCell({ order }: { order: Order }) {
  const [broken, setBroken] = useState(false)
  const key = order.idempotencykey

  if (key && !broken) {
    const src = comprobanteUrl(String(key))
    return (
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-block ml-auto"
        title="Ver comprobante"
      >
        <img
          src={src}
          alt="comprobante"
          onError={() => setBroken(true)}
          className="w-10 h-10 rounded-lg object-cover border border-white/10 hover:border-brand-500/60 transition"
        />
      </a>
    )
  }

  if (order.comprobante && order.comprobante.startsWith("http")) {
    return (
      <a
        href={order.comprobante}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 text-xs text-brand-300 hover:text-brand-200"
      >
        Ver <ExternalLink className="w-3 h-3" />
      </a>
    )
  }

  return <span className="text-xs text-white/60">{order.comprobante || "—"}</span>
}

function labelFor(f: Filter): string {
  switch (f) {
    case "all":
      return "Todas"
    case "today":
      return "Hoy"
    case "platino":
      return "Platino"
    case "diamante":
      return "Diamante"
  }
}
