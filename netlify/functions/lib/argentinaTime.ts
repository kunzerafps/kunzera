// Argentina es UTC-3 fijo (sin horario de verano desde 2009) — restar 3hs
// antes de cortar a YYYY-MM-DD evita clasificar mal un timestamp cercano a la
// medianoche real en Argentina (ej. 23:50 hora local no debe caer en el día
// siguiente solo porque en UTC ya es "mañana").
const ARG_OFFSET_MS = 3 * 60 * 60 * 1000

export function dateOnlyInArgentina(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === "number" ? isoOrMs : new Date(isoOrMs).getTime()
  return new Date(ms - ARG_OFFSET_MS).toISOString().slice(0, 10)
}

export function todayInArgentina(): string {
  return dateOnlyInArgentina(Date.now())
}

export function daysAgoInArgentina(days: number): string {
  return dateOnlyInArgentina(Date.now() - days * 24 * 60 * 60 * 1000)
}
