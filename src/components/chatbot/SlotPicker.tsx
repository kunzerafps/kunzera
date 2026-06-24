import { motion } from "framer-motion"
import { Clock, Loader2, RefreshCw } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { Slot } from "../../types/order"
import { formatDayLabel } from "../../lib/formatters"
import { TIMEZONE } from "../../lib/constants"

type Props = {
  slots: Slot[]
  loading: boolean
  error: boolean
  onPick: (iso: string) => void
  onRefresh: () => void
}

export default function SlotPicker({ slots, loading, error, onPick, onRefresh }: Props) {
  const days = useMemo(() => {
    const map = new Map<string, Slot[]>()
    for (const s of slots) {
      const arr = map.get(s.dayKey) ?? []
      arr.push(s)
      map.set(s.dayKey, arr)
    }
    return Array.from(map.entries())
  }, [slots])

  const [selectedDay, setSelectedDay] = useState<string | null>(null)

  useEffect(() => {
    if (!days.length) {
      setSelectedDay(null)
      return
    }
    if (!selectedDay || !days.find(([k]) => k === selectedDay)) {
      setSelectedDay(days[0][0])
    }
  }, [days, selectedDay])

  if (loading) {
    return (
      <div className="mt-2 flex items-center gap-2 text-white/50 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Cargando turnos disponibles…
      </div>
    )
  }

  if (error) {
    return (
      <div className="mt-2 flex flex-col gap-2">
        <div className="text-red-400 text-sm">No pudimos cargar los turnos.</div>
        <button
          onClick={onRefresh}
          className="self-start inline-flex items-center gap-2 px-3 py-1.5 text-xs rounded-full bg-brand-950/80 border border-brand-700/50 hover:border-brand-500 text-brand-200"
        >
          <RefreshCw className="w-3 h-3" /> Reintentar
        </button>
      </div>
    )
  }

  if (slots.length === 0) {
    return (
      <div className="mt-2 text-white/60 text-sm">
        No hay turnos libres en los próximos 30 días. Probá recargar en un rato.
      </div>
    )
  }

  const selected = days.find(([k]) => k === selectedDay) ?? days[0]
  const selectedSlots = selected ? selected[1] : []
  const selectedKey = selected ? selected[0] : ""

  return (
    <div className="mt-2 flex flex-col gap-3">
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {days.map(([dayKey, daySlots]) => (
          <DayPill
            key={dayKey}
            dayKey={dayKey}
            count={daySlots.length}
            active={dayKey === selectedKey}
            onClick={() => setSelectedDay(dayKey)}
          />
        ))}
      </div>

      <div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-white/40 mb-1.5">
          <Clock className="w-3 h-3" />
          {formatDayLabel(selectedKey)} · {selectedSlots.length} hueco{selectedSlots.length !== 1 ? "s" : ""}
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-[35vh] overflow-y-auto pr-1">
          {selectedSlots.map((s) => (
            <motion.button
              key={s.iso}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => onPick(s.iso)}
              className="px-3 py-1.5 text-xs font-mono rounded-full bg-brand-950/80 border border-brand-700/50 hover:border-brand-500 hover:bg-brand-900 text-brand-100 transition"
            >
              {s.hour}
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  )
}

function DayPill({
  dayKey,
  count,
  active,
  onClick,
}: {
  dayKey: string
  count: number
  active: boolean
  onClick: () => void
}) {
  const date = new Date(`${dayKey}T12:00:00-03:00`)
  const weekday = new Intl.DateTimeFormat("es-AR", {
    timeZone: TIMEZONE,
    weekday: "short",
  })
    .format(date)
    .replace(".", "")
  const day = new Intl.DateTimeFormat("es-AR", {
    timeZone: TIMEZONE,
    day: "2-digit",
  }).format(date)
  const cap = weekday.charAt(0).toUpperCase() + weekday.slice(1)

  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className={`shrink-0 flex flex-col items-center justify-center w-14 py-2 rounded-xl border transition ${
        active
          ? "bg-brand-500 border-brand-400 text-white shadow-glow-red"
          : "bg-brand-950/80 border-brand-700/50 text-brand-200 hover:border-brand-500 hover:bg-brand-900"
      }`}
    >
      <span className="text-[10px] font-mono uppercase tracking-wider opacity-80">
        {cap}
      </span>
      <span className="text-base font-display font-bold leading-tight">{day}</span>
      <span
        className={`text-[9px] font-mono mt-0.5 ${
          active ? "text-white/80" : "text-brand-300/60"
        }`}
      >
        {count}
      </span>
    </motion.button>
  )
}
