const STORAGE_KEY = "kz_utm_v1"
const MAX_LEN = 100

export type UtmData = {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
}

function clean(value: string | null): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim().slice(0, MAX_LEN)
  return trimmed || undefined
}

// Se llama una sola vez al cargar el sitio (ver main.tsx). Si el link no
// trae utm_source, no toca lo que ya había guardado — así una recarga o una
// navegación sin esos parámetros no borra la campaña real que trajo a la
// visita. sessionStorage (no localStorage): la campaña vale para esta
// visita, no para siempre.
export function captureUtm(): void {
  try {
    const params = new URLSearchParams(window.location.search)
    const utm_source = clean(params.get("utm_source"))
    if (!utm_source) return
    const data: UtmData = {
      utm_source,
      utm_medium: clean(params.get("utm_medium")),
      utm_campaign: clean(params.get("utm_campaign")),
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // sessionStorage no disponible (modo privado, etc.) — no rompe nada
  }
}

export function getStoredUtm(): UtmData {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as UtmData) : {}
  } catch {
    return {}
  }
}
