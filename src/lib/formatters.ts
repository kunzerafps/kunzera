import { TIMEZONE } from "./constants"

export function formatARS(amount: number): string {
  const n = Number(amount)
  if (!Number.isFinite(n)) return "$ 0"
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

function toValidDate(iso: string | Date | null | undefined): Date | null {
  if (!iso) return null
  try {
    const d = iso instanceof Date ? iso : new Date(iso)
    return Number.isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

export function formatDateAR(iso: string | Date | null | undefined): string {
  const d = toValidDate(iso)
  if (!d) return "—"
  try {
    return new Intl.DateTimeFormat("es-AR", {
      timeZone: TIMEZONE,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d)
  } catch {
    return "—"
  }
}

export function formatTimeAR(iso: string | Date | null | undefined): string {
  const d = toValidDate(iso)
  if (!d) return "--:--"
  try {
    return new Intl.DateTimeFormat("es-AR", {
      timeZone: TIMEZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d)
  } catch {
    return "--:--"
  }
}

function getDayInAR(d: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d)
  } catch {
    return ""
  }
}

export function formatSlotLabel(iso: string | Date | null | undefined, now: Date = new Date()): string {
  const slot = toValidDate(iso)
  if (!slot) return "—"
  const today = getDayInAR(now)
  const slotDay = getDayInAR(slot)
  const tomorrow = getDayInAR(new Date(now.getTime() + 24 * 3600 * 1000))
  const dayTomorrow = getDayInAR(new Date(now.getTime() + 48 * 3600 * 1000))

  const hour = formatTimeAR(slot)
  if (slotDay === today) return `Hoy ${hour}`
  if (slotDay === tomorrow) return `Mañana ${hour}`
  if (slotDay === dayTomorrow) return `Pasado ${hour}`

  try {
    const d = new Intl.DateTimeFormat("es-AR", {
      timeZone: TIMEZONE,
      day: "2-digit",
      month: "2-digit",
    }).format(slot)
    return `${d} ${hour}`
  } catch {
    return hour
  }
}

export function formatDayLabel(dayKey: string, now: Date = new Date()): string {
  if (!dayKey) return "—"
  const todayKey = getDayInAR(now)
  const tomorrowKey = getDayInAR(new Date(now.getTime() + 24 * 3600 * 1000))
  const dayAfterKey = getDayInAR(new Date(now.getTime() + 48 * 3600 * 1000))

  if (dayKey === todayKey) return "Hoy"
  if (dayKey === tomorrowKey) return "Mañana"
  if (dayKey === dayAfterKey) return "Pasado"

  try {
    const d = new Date(`${dayKey}T12:00:00-03:00`)
    const weekday = new Intl.DateTimeFormat("es-AR", {
      timeZone: TIMEZONE,
      weekday: "long",
    }).format(d)
    const dm = new Intl.DateTimeFormat("es-AR", {
      timeZone: TIMEZONE,
      day: "2-digit",
      month: "2-digit",
    }).format(d)
    const cap = weekday.charAt(0).toUpperCase() + weekday.slice(1)
    return `${cap} ${dm}`
  } catch {
    return dayKey
  }
}

export function isToday(iso: string | Date | null | undefined, now: Date = new Date()): boolean {
  const d = toValidDate(iso)
  if (!d) return false
  return getDayInAR(d) === getDayInAR(now)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function getDayKey(iso: string | Date | null | undefined): string {
  const d = toValidDate(iso)
  if (!d) return ""
  return getDayInAR(d)
}
