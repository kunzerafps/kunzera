import { APPS_SCRIPT_URL, ADMIN_SECRET_TOKEN } from "../../../src/lib/constants"
import type { Order } from "../../../src/types/order"

// Lee las reservas del Sheet (Apps Script). Compartido por daily-gap-report y
// admin-ingresos. Mismo bug de CORS intermitente que appsScript.ts del lado
// del cliente — reintentar es más simple y confiable que investigar el
// redirect de Apps Script. Presupuesto de reintentos recortado porque las
// Scheduled Functions de Netlify tienen un techo duro de 30s.
const ATTEMPTS = 3
const TIMEOUT_MS = 7000
const RETRY_WAIT_MS = 400

export async function getSheetOrders(): Promise<Order[]> {
  const url = `${APPS_SCRIPT_URL}?action=getOrders&token=${encodeURIComponent(ADMIN_SECRET_TOKEN)}`
  let lastErr = "unknown"
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_WAIT_MS))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: "follow" })
      clearTimeout(timer)
      if (!res.ok) {
        lastErr = `http_${res.status}`
        continue
      }
      const data = (await res.json()) as { ok: boolean; orders?: Order[]; error?: string }
      if (data.ok) return data.orders || []
      lastErr = data.error || "unknown"
    } catch (err) {
      clearTimeout(timer)
      lastErr = err instanceof Error ? err.message : String(err)
    }
  }
  throw new Error(`no se pudieron leer las reservas del Sheet: ${lastErr}`)
}
