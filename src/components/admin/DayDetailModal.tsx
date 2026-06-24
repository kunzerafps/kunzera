import { AnimatePresence, motion } from "framer-motion"
import { CheckCircle2, Clock, X } from "lucide-react"
import { useMemo } from "react"
import { createPortal } from "react-dom"
import type { Order, Pack } from "../../types/order"
import { PACKS } from "../../lib/packs"
import { formatARS, getDayKey } from "../../lib/formatters"

type Props = {
  dayKey: string | null
  orders: Order[]
  onClose: () => void
  onSelectOrder: (order: Order) => void
}

const WEEKDAYS_LONG = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
]
const MONTHS_ES_LONG = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
]

export default function DayDetailModal({ dayKey, orders, onClose, onSelectOrder }: Props) {
  const dayOrders = useMemo(() => {
    if (!dayKey) return []
    return orders
      .filter((o) => o.turno && getDayKey(o.turno) === dayKey)
      .sort((a, b) => new Date(a.turno).getTime() - new Date(b.turno).getTime())
  }, [orders, dayKey])

  const dayLabel = useMemo(() => {
    if (!dayKey) return ""
    // dayKey: "YYYY-MM-DD"
    const [y, m, d] = dayKey.split("-").map(Number)
    const date = new Date(y, m - 1, d)
    const dayName = WEEKDAYS_LONG[date.getDay()]
    const monthName = MONTHS_ES_LONG[m - 1]
    return `${dayName} ${d} de ${monthName}`
  }, [dayKey])

  const stats = useMemo(() => {
    let monto = 0
    let atendidos = 0
    const byPlan: Record<Pack, number> = { platino: 0, diamante: 0 }
    for (const o of dayOrders) {
      monto += Number(o.monto) || 0
      if (String(o.estado || "").toLowerCase() === "atendido") atendidos++
      if (o.plan === "platino" || o.plan === "diamante") byPlan[o.plan]++
    }
    return { monto, atendidos, byPlan }
  }, [dayOrders])

  if (typeof document === "undefined") return null
  return createPortal(
    <AnimatePresence>
      {dayKey && (
        <>
          <motion.div
            key="day-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/85"
            onClick={onClose}
          />
          <div className="fixed inset-0 z-[62] flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              key="day-modal"
              initial={{ opacity: 0, scale: 0.94, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 20 }}
              transition={{ type: "spring", damping: 26, stiffness: 260 }}
              className="pointer-events-auto w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl overflow-hidden border border-brand-900/60 bg-[#0c0204] shadow-2xl shadow-brand-950/70"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="relative p-5 md:p-6 pb-4 bg-gradient-to-br from-brand-700 via-brand-800 to-brand-950 overflow-hidden flex-shrink-0">
                <div
                  className="absolute inset-0 opacity-30 pointer-events-none"
                  style={{
                    backgroundImage:
                      "linear-gradient(rgba(239,19,19,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(239,19,19,0.15) 1px, transparent 1px)",
                    backgroundSize: "20px 20px",
                  }}
                />
                <div className="relative flex items-start gap-3">
                  <div className="flex-1">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-white/60">
                      Turnos del día
                    </div>
                    <div className="font-display font-black text-white text-xl md:text-2xl leading-tight mt-0.5 capitalize">
                      {dayLabel}
                    </div>
                    {dayOrders.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-mono">
                        <span className="px-2 py-0.5 rounded-full bg-white/10 text-white/90">
                          {dayOrders.length} turno{dayOrders.length !== 1 ? "s" : ""}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-white/10 text-white/90">
                          {formatARS(stats.monto)}
                        </span>
                        {stats.atendidos > 0 && (
                          <span className="px-2 py-0.5 rounded-full bg-green-500/20 text-green-200 border border-green-500/30">
                            {stats.atendidos}/{dayOrders.length} atendidos
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={onClose}
                    className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center flex-shrink-0"
                    aria-label="Cerrar"
                  >
                    <X className="w-4 h-4 text-white" />
                  </button>
                </div>
              </div>

              {/* List */}
              <div
                className="flex-1 overflow-y-auto p-3 md:p-4 space-y-2"
                style={{ scrollbarWidth: "thin" }}
              >
                {dayOrders.length === 0 ? (
                  <div className="text-center py-16 text-white/40">
                    <Clock className="w-8 h-8 mx-auto mb-3 opacity-50" />
                    <div className="text-sm">No hay turnos reservados este día</div>
                  </div>
                ) : (
                  dayOrders.map((o, i) => (
                    <SlotRow
                      key={`${o.timestamp}-${i}`}
                      order={o}
                      onClick={() => onSelectOrder(o)}
                    />
                  ))
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function SlotRow({ order, onClick }: { order: Order; onClick: () => void }) {
  const pack = order.plan as Pack
  const packInfo = PACKS[pack]
  const atendido = String(order.estado || "").toLowerCase() === "atendido"

  const hour = (() => {
    try {
      return new Date(order.turno).toLocaleTimeString("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "America/Argentina/Buenos_Aires",
      })
    } catch {
      return "--:--"
    }
  })()

  return (
    <motion.button
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      onClick={onClick}
      className={`w-full flex items-center gap-3 md:gap-4 p-3 md:p-4 rounded-xl border text-left transition ${
        atendido
          ? "bg-green-500/5 border-green-500/30 hover:bg-green-500/10"
          : "bg-white/[0.03] border-white/10 hover:bg-white/[0.06] hover:border-brand-500/40"
      }`}
    >
      {/* Hour */}
      <div
        className={`flex-shrink-0 w-16 md:w-20 text-center px-2 py-2 rounded-lg font-mono font-bold text-lg md:text-xl ${
          atendido
            ? "bg-green-500/10 text-green-200 border border-green-500/30"
            : "bg-brand-950/60 text-brand-200 border border-brand-700/40"
        }`}
      >
        {hour}
      </div>

      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-lg leading-none">{packInfo?.emoji || "🎟️"}</span>
          <span className="font-display font-bold text-white truncate">
            {order.nombre || "Sin nombre"}
          </span>
          {atendido && (
            <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
          <span
            className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono uppercase ${
              pack === "diamante"
                ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                : "bg-brand-500/20 text-brand-300 border border-brand-500/30"
            }`}
          >
            {pack}
          </span>
          <span className="font-mono">{formatARS(Number(order.monto) || 0)}</span>
          <span className="text-white/40 truncate">{order.discord || "—"}</span>
        </div>
      </div>

      {/* Arrow */}
      <div className="text-white/30 flex-shrink-0 text-sm">→</div>
    </motion.button>
  )
}
