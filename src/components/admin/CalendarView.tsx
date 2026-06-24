import { motion } from "framer-motion"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useMemo, useState } from "react"
import type { Order } from "../../types/order"
import { getDayKey } from "../../lib/formatters"

type Props = {
  orders: Order[]
  onSelectDay: (dayKey: string) => void
}

const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"]
const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]

export default function CalendarView({ orders, onSelectDay }: Props) {
  const [viewDate, setViewDate] = useState(() => new Date())

  const ordersByDay = useMemo(() => {
    const map = new Map<string, Order[]>()
    for (const o of orders) {
      if (!o.turno) continue
      const key = getDayKey(o.turno)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(o)
    }
    // sort slots within each day
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.turno).getTime() - new Date(b.turno).getTime())
    }
    return map
  }, [orders])

  const grid = useMemo(() => buildGrid(viewDate), [viewDate])
  const todayKey = getDayKey(new Date())
  const monthLabel = `${MONTHS_ES[viewDate.getMonth()]} ${viewDate.getFullYear()}`

  const prevMonth = () => {
    setViewDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  }
  const nextMonth = () => {
    setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
  }
  const goToday = () => setViewDate(new Date())

  return (
    <div className="glass-card rounded-2xl p-4 md:p-6">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h3 className="font-display font-bold text-white text-lg capitalize">{monthLabel}</h3>
          <p className="text-xs text-white/40 font-mono">Click en un día para ver sus turnos</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={prevMonth}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center"
            aria-label="Mes anterior"
          >
            <ChevronLeft className="w-4 h-4 text-white" />
          </button>
          <button
            onClick={goToday}
            className="px-3 h-8 rounded-lg bg-brand-950/80 hover:border-brand-500 border border-brand-700/50 text-xs text-brand-200"
          >
            Hoy
          </button>
          <button
            onClick={nextMonth}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center"
            aria-label="Mes siguiente"
          >
            <ChevronRight className="w-4 h-4 text-white" />
          </button>
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((d, i) => (
          <div
            key={i}
            className="text-center text-[10px] font-mono uppercase tracking-widest text-white/40 py-1"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {grid.map((cell, i) => {
          const dayOrders = cell.dateKey ? ordersByDay.get(cell.dateKey) || [] : []
          const isToday = cell.dateKey === todayKey
          const isOutOfMonth = cell.outOfMonth
          const count = dayOrders.length
          const atendidos = dayOrders.filter(
            (o) => String(o.estado || "").toLowerCase() === "atendido",
          ).length
          const allDone = count > 0 && atendidos === count
          const hasDiamante = dayOrders.some((o) => o.plan === "diamante")
          const hasPlatino = dayOrders.some((o) => o.plan === "platino")

          return (
            <motion.button
              key={i}
              whileHover={!isOutOfMonth && cell.dateKey ? { scale: 1.02 } : {}}
              whileTap={!isOutOfMonth && cell.dateKey ? { scale: 0.98 } : {}}
              onClick={() => {
                if (!isOutOfMonth && cell.dateKey) onSelectDay(cell.dateKey)
              }}
              disabled={isOutOfMonth || !cell.dateKey}
              className={`relative min-h-[64px] sm:min-h-[82px] md:min-h-[96px] rounded-lg p-1.5 sm:p-2 flex flex-col items-start gap-1 border text-left transition ${
                isOutOfMonth
                  ? "bg-black/20 border-white/5 opacity-40 cursor-default"
                  : count === 0
                  ? isToday
                    ? "bg-brand-500/10 border-brand-500/40 hover:bg-brand-500/15"
                    : "bg-white/[0.02] border-white/5 hover:bg-white/[0.05] hover:border-white/20"
                  : allDone
                  ? "bg-green-500/10 border-green-500/40 hover:bg-green-500/15"
                  : isToday
                  ? "bg-brand-500/15 border-brand-500/50 hover:bg-brand-500/25"
                  : "bg-brand-500/5 border-brand-500/30 hover:bg-brand-500/15 hover:border-brand-500/60"
              }`}
              title={cell.dateKey && count > 0 ? `${count} turno${count !== 1 ? "s" : ""}` : ""}
            >
              {cell.day && (
                <>
                  <span
                    className={`text-sm md:text-base font-display font-bold ${
                      isToday
                        ? "text-brand-300"
                        : allDone
                        ? "text-green-300"
                        : count > 0
                        ? "text-white"
                        : "text-white/50"
                    }`}
                  >
                    {cell.day}
                  </span>

                  {count > 0 && (
                    <div className="mt-auto w-full flex flex-col gap-1">
                      <div
                        className={`inline-flex items-center justify-center text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full ${
                          allDone
                            ? "bg-green-500/20 text-green-200 border border-green-500/40"
                            : "bg-brand-500/20 text-brand-200 border border-brand-500/40"
                        }`}
                      >
                        {allDone && <span className="mr-0.5">✓</span>}
                        {count} turno{count !== 1 ? "s" : ""}
                      </div>
                      {(hasPlatino || hasDiamante) && (
                        <div className="flex items-center gap-1">
                          {hasPlatino && (
                            <span
                              className="w-1.5 h-1.5 rounded-full bg-brand-400"
                              title="Platino"
                            />
                          )}
                          {hasDiamante && (
                            <span
                              className="w-1.5 h-1.5 rounded-full bg-blue-400"
                              title="Diamante"
                            />
                          )}
                          {atendidos > 0 && !allDone && (
                            <span className="text-[9px] font-mono text-green-300 ml-auto">
                              {atendidos}/{count}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </motion.button>
          )
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-3 text-[10px] font-mono text-white/40">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-400" /> Platino
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400" /> Diamante
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-green-500/40 border border-green-500/60" /> Todos atendidos
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-brand-500/20 border border-brand-500/50" /> Hoy
        </span>
      </div>
    </div>
  )
}

type Cell = { day: number | null; dateKey: string | null; outOfMonth: boolean }

function buildGrid(viewDate: Date): Cell[] {
  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const firstOfMonth = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  // weekday: 0 = Sunday → convertir a índice L=0
  const startWeekday = (firstOfMonth.getDay() + 6) % 7
  const cells: Cell[] = []

  // días del mes anterior (relleno)
  const prevMonthDays = new Date(year, month, 0).getDate()
  for (let i = startWeekday - 1; i >= 0; i--) {
    const day = prevMonthDays - i
    const d = new Date(year, month - 1, day)
    cells.push({ day, dateKey: getDayKey(d), outOfMonth: true })
  }

  // días del mes actual
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month, day)
    cells.push({ day, dateKey: getDayKey(d), outOfMonth: false })
  }

  // completar hasta múltiplo de 7 (con días del mes siguiente)
  while (cells.length % 7 !== 0) {
    const remainingIdx = cells.length - (startWeekday + daysInMonth) + 1
    const d = new Date(year, month + 1, remainingIdx)
    cells.push({ day: remainingIdx, dateKey: getDayKey(d), outOfMonth: true })
  }

  return cells
}
