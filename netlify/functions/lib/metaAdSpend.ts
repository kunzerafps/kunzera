// Trae el gasto de anuncios de Meta (Marketing API). Usa el mismo token y
// ad account que daily-gap-report.mts (META_MARKETING_ACCESS_TOKEN /
// META_AD_ACCOUNT_ID).

const META_AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID || "215090675"
const FETCH_TIMEOUT_MS = 10000

export type AdSpend = {
  // Gasto total del rango, en la moneda de la cuenta de anuncios.
  total: number
  currency: string
  // Gasto por campaña — la clave es el nombre de campaña tal cual lo tiene
  // Meta. Vacío si la API no devolvió el desglose.
  porCampana: Record<string, number>
}

type InsightRow = {
  spend?: string
  campaign_name?: string
  account_currency?: string
}

type InsightsResponse = {
  data?: InsightRow[]
  paging?: { next?: string }
  error?: { message: string }
}

// Tope de páginas por si algo se va de mano (500 campañas/página × 8 = 4000).
const MAX_PAGES = 8

// since / until en formato YYYY-MM-DD (hora de la cuenta de Meta).
export async function fetchAdSpend(
  since: string,
  until: string,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<AdSpend> {
  const token = process.env.META_MARKETING_ACCESS_TOKEN
  if (!token) throw new Error("META_MARKETING_ACCESS_TOKEN no está configurado")

  const timeRange = encodeURIComponent(JSON.stringify({ since, until }))
  let url =
    `https://graph.facebook.com/v21.0/act_${META_AD_ACCOUNT_ID}/insights` +
    `?fields=spend,campaign_name,account_currency&level=campaign&time_range=${timeRange}` +
    `&limit=500&access_token=${encodeURIComponent(token)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let total = 0
    let currency = "ARS"
    const porCampana: Record<string, number> = {}

    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await fetch(url, { signal: controller.signal })
      const body = await res.text()
      let data: InsightsResponse
      try {
        data = JSON.parse(body) as InsightsResponse
      } catch {
        throw new Error(`http_${res.status}: respuesta no-JSON`)
      }
      if (!res.ok || data.error) {
        throw new Error(data.error?.message || `http_${res.status}`)
      }
      for (const r of data.data || []) {
        const spend = Number(r.spend) || 0
        total += spend
        if (r.account_currency) currency = r.account_currency
        const name = (r.campaign_name || "sin nombre").trim()
        porCampana[name] = (porCampana[name] || 0) + spend
      }
      if (!data.paging?.next) break
      url = data.paging.next
    }

    return { total: Math.round(total * 100) / 100, currency, porCampana }
  } finally {
    clearTimeout(timer)
  }
}
