import {
  SLOT_END_HOUR,
  SLOT_START_HOUR,
  SLOT_STEP_MIN,
  TIMEZONE,
} from "./constants"
import type { Slot } from "../types/order"
import { formatSlotLabel, formatTimeAR } from "./formatters"

/**
 * Devuelve "YYYY-MM-DD" del momento `d` en la zona horaria AR.
 */
function getDayKeyAR(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d)
}

/**
 * Obtiene un Date que representa el instante "YYYY-MM-DD HH:MM" en tz AR.
 * Aproximamos AR como UTC-3 fijo (no hay DST en Argentina desde 2009).
 */
function arDateTime(dayKey: string, hour: number, minute: number): Date {
  // dayKey es "YYYY-MM-DD". Creamos ISO con offset -03:00.
  const hh = String(hour).padStart(2, "0")
  const mm = String(minute).padStart(2, "0")
  return new Date(`${dayKey}T${hh}:${mm}:00-03:00`)
}

function addDays(dayKey: string, n: number): string {
  const d = new Date(`${dayKey}T12:00:00-03:00`)
  d.setUTCDate(d.getUTCDate() + n)
  return getDayKeyAR(d)
}

type DayBlock = {
  dayKey: string
  slots: Date[]
}

/**
 * Genera los N slots de un día "base" (15:00–01:30 del día siguiente).
 * Cada slot empieza a startHour + i * STEP_MIN, en minutos totales desde 15:00.
 */
function generateDayBlock(dayKey: string): DayBlock {
  const slots: Date[] = []
  const totalMin = (24 - SLOT_START_HOUR + SLOT_END_HOUR) * 60 // 11h = 660min
  const count = Math.floor(totalMin / SLOT_STEP_MIN) // 19

  for (let i = 0; i < count; i++) {
    const offsetMin = i * SLOT_STEP_MIN
    const hour = SLOT_START_HOUR + Math.floor(offsetMin / 60)
    const minute = offsetMin % 60

    if (hour < 24) {
      slots.push(arDateTime(dayKey, hour, minute))
    } else {
      const nextDay = addDays(dayKey, 1)
      slots.push(arDateTime(nextDay, hour - 24, minute))
    }
  }
  return { dayKey, slots }
}

/**
 * Devuelve el día de la semana (0=Dom..6=Sáb) en zona horaria AR
 * para el dayKey "YYYY-MM-DD" recibido.
 */
function weekdayAR(dayKey: string): number {
  const d = new Date(`${dayKey}T12:00:00-03:00`)
  return d.getUTCDay()
}

export type BlockedRange = { start: string; end: string }

/**
 * Genera todos los slots disponibles desde `now` hasta el final del
 * domingo de la semana actual (en hora AR). Filtra los que ya pasaron,
 * los que están en `takenIso` y los que caen dentro de `blockedRanges`.
 */
export function generateSlots(
  takenIso: string[] = [],
  now: Date = new Date(),
  blockedRanges: BlockedRange[] = [],
): Slot[] {
  const takenSet = new Set(takenIso.map(normalizeIso))
  const blockedMs = blockedRanges
    .map((r) => ({
      start: new Date(r.start).getTime(),
      end: new Date(r.end).getTime(),
    }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)

  const todayKey = getDayKeyAR(now)
  const yesterdayKey = addDays(todayKey, -1) // por si son las 00:30 y queremos slots del "día anterior"

  // Días que faltan hasta el domingo inclusive (lunes=7, ..., sábado=2, domingo=1)
  const daysUntilSunday = ((0 - weekdayAR(todayKey) + 7) % 7) + 1
  const lastDayKey = addDays(todayKey, daysUntilSunday - 1)

  const blocks: DayBlock[] = [generateDayBlock(yesterdayKey)]
  for (let i = 0; i < daysUntilSunday; i++) {
    blocks.push(generateDayBlock(addDays(todayKey, i)))
  }

  const out: Slot[] = []
  for (const block of blocks) {
    for (const d of block.slots) {
      if (d <= now) continue
      const slotDayKey = getDayKeyAR(d)
      if (slotDayKey > lastDayKey) continue
      const iso = d.toISOString()
      const normalizedIso = normalizeIso(iso)
      if (takenSet.has(normalizedIso)) continue
      const t = d.getTime()
      if (blockedMs.some((b) => t >= b.start && t < b.end)) continue

      out.push({
        iso,
        label: formatSlotLabel(iso, now),
        dayKey: slotDayKey,
        hour: formatTimeAR(d),
        taken: false,
      })
    }
  }

  out.sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime())
  return out
}

/**
 * Normaliza un ISO a comparable (ignora ms, fuerza segundos a 0).
 */
export function normalizeIso(iso: string): string {
  try {
    const d = new Date(iso)
    d.setSeconds(0, 0)
    return d.toISOString()
  } catch {
    return iso
  }
}
