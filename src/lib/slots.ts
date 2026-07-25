import {
  SAT_SLOT_END_HOUR,
  SAT_SLOT_START_HOUR,
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

/** true si `dayKey` (YYYY-MM-DD en hora AR) cae domingo. */
function isSundayAR(dayKey: string): boolean {
  const day = new Date(`${dayKey}T12:00:00-03:00`).getUTCDay()
  return day === 0
}

/** true si `dayKey` (YYYY-MM-DD en hora AR) cae sábado. */
function isSaturdayAR(dayKey: string): boolean {
  const day = new Date(`${dayKey}T12:00:00-03:00`).getUTCDay()
  return day === 6
}

/** Ventana horaria (start/end) aplicable a `dayKey`: sábado usa su propio rango. */
function hoursForDay(dayKey: string): { start: number; end: number } {
  if (isSaturdayAR(dayKey)) {
    return { start: SAT_SLOT_START_HOUR, end: SAT_SLOT_END_HOUR }
  }
  return { start: SLOT_START_HOUR, end: SLOT_END_HOUR }
}

/**
 * Genera los turnos de un día "base" (startHour–endHour, cada SLOT_STEP_MIN).
 * Cada slot empieza a startHour + i * STEP_MIN.
 */
function generateDayBlock(
  dayKey: string,
  startHour: number = SLOT_START_HOUR,
  endHour: number = SLOT_END_HOUR,
): DayBlock {
  const slots: Date[] = []
  // Ventana del día. Si END > START es mismo día; si no, cruza la medianoche.
  const windowMin =
    endHour > startHour
      ? (endHour - startHour) * 60
      : (24 - startHour + endHour) * 60
  const count = Math.floor(windowMin / SLOT_STEP_MIN)

  for (let i = 0; i < count; i++) {
    const offsetMin = i * SLOT_STEP_MIN
    const hour = startHour + Math.floor(offsetMin / 60)
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

export type BlockedRange = { start: string; end: string }

/** Cuántos días hacia adelante se pueden reservar, contando desde hoy. */
export const RESERVATION_HORIZON_DAYS = 30

/**
 * Genera todos los slots disponibles desde `now` hasta 30 días en el
 * futuro (en hora AR). Filtra los que ya pasaron, los que están en
 * `takenIso` y los que caen dentro de `blockedRanges`.
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

  // Ventana de reserva: desde hoy hasta 30 días en el futuro (inclusive).
  const lastDayKey = addDays(todayKey, RESERVATION_HORIZON_DAYS)

  const blockFor = (dayKey: string) => {
    const { start, end } = hoursForDay(dayKey)
    return generateDayBlock(dayKey, start, end)
  }

  const blocks: DayBlock[] = [blockFor(yesterdayKey)]
  for (let i = 0; i <= RESERVATION_HORIZON_DAYS; i++) {
    blocks.push(blockFor(addDays(todayKey, i)))
  }

  const out: Slot[] = []
  for (const block of blocks) {
    for (const d of block.slots) {
      if (d <= now) continue
      const slotDayKey = getDayKeyAR(d)
      if (slotDayKey > lastDayKey) continue
      if (isSundayAR(slotDayKey)) continue
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
