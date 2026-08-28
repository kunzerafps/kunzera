import { APPS_SCRIPT_URL, ADMIN_SECRET_TOKEN } from "../../../src/lib/constants"
import type { Order } from "../../../src/types/order"

// Lee las reservas del Sheet (Apps Script). Compartido por daily-gap-report y
// admin-ingresos. Mismo bug de CORS intermitente que appsScript.ts del lado
// del cliente — reintentar es más simple y confiable que investigar el
// redirect de Apps Script.
//
// El presupuesto de reintentos es configurable porque los dos callers tienen
// techos distintos: daily-gap-report es una Scheduled Function (30s) y usa el
// default (3×7s+2×0.4s ≈ 21.8s); admin-ingresos es on-demand (10s) y le pasa
// un presupuesto más corto.
type Budget = { attempts?: number; timeoutMs?: number; retryWaitMs?: number }
const DEFAULT_BUDGET: Required<Budget> = { attempts: 3, timeoutMs: 7000, retryWaitMs: 400 }

export async function getSheetOrders(opts: Budget = {}): Promise<Order[]> {
  const { attempts, timeoutMs, retryWaitMs } = { ...DEFAULT_BUDGET, ...opts }
  const url = `${APPS_SCRIPT_URL}?action=getOrders&token=${encodeURIComponent(ADMIN_SECRET_TOKEN)}`
  let lastErr = "unknown"
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, retryWaitMs))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
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
