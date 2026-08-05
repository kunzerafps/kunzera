import type { Config, Context } from "@netlify/functions"
import { APPS_SCRIPT_URL, ADMIN_SECRET_TOKEN, TIMEZONE } from "../../src/lib/constants"
import type { Order } from "../../src/types/order"
import { listRecentDeliveries } from "./lib/deliveryLog"
import { notifyDiscord } from "./lib/discordAlert"

// Cuenta cuántas ventas reales hubo "ayer" (hora Argentina) según dos
// fuentes independientes de lo que se le mandó a Meta, y lo compara contra
// lo que Meta dice haber contado — el objetivo es detectar en silencio
// (Discord solo avisa si hay diferencia) si algo se rompió en la cadena de
// envío sin que nadie lo note por semanas.
const META_AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID || "215090675"

// Mismo criterio que capi-venta-manual.mts: Argentina es UTC-3 fijo (sin
// horario de verano desde 2009).
function daysAgoInArgentina(days: number): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000 - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

function dateOnlyInArgentina(isoOrMs: string | number): string {
  const ms = typeof isoOrMs === "number" ? isoOrMs : new Date(isoOrMs).getTime()
  return new Date(ms - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// Mismo bug de CORS intermitente que appsScript.ts (getOrders) del lado del
// cliente — algunos intentos fallan solos, reintentar es más simple y más
// confiable que investigar el redirect de Apps Script a fondo.
async function fetchOrders(): Promise<Order[]> {
  const url = `${APPS_SCRIPT_URL}?action=getOrders&token=${encodeURIComponent(ADMIN_SECRET_TOKEN)}`
  let lastErr = "unknown"
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 25000)
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

// Ventas confirmadas en el Sheet (Mercado Pago + transferencia/binance ya
// revisadas por el admin) — no cuenta "pendiente", que todavía no generó
// ningún evento de Compra en Meta.
function countSheetSales(orders: Order[], dateStr: string): number {
  return orders.filter((o) => {
    const estado = String(o.estado || "").toLowerCase()
    const esVenta = estado === "confirmado" || estado === "atendido"
    return esVenta && dateOnlyInArgentina(o.timestamp) === dateStr
  }).length
}

// Ventas manuales (cerradas por WhatsApp, sin reserva en el Sheet) que sí se
// mandaron a Meta ese día — quedan solo en el log de entregas, ver
// deliveryLog.ts. Aproximación conocida: usa la fecha en que el admin cargó
// la venta en el panel (lastAttemptAt), no la fecha real de la venta que se
// puede backdatear hasta 7 días — en la práctica el admin la carga el mismo
// día o al siguiente, así que el desfasaje esperable es chico.
function countManualSales(entries: Awaited<ReturnType<typeof listRecentDeliveries>>, dateStr: string): number {
  return entries.filter(
    (e) => e.source === "venta_manual" && e.ok && !e.dedupedLocally && dateOnlyInArgentina(e.lastAttemptAt) === dateStr,
  ).length
}

async function fetchMetaPurchaseCount(dateStr: string): Promise<number> {
  const token = process.env.META_MARKETING_ACCESS_TOKEN
  if (!token) throw new Error("META_MARKETING_ACCESS_TOKEN no está configurado")

  const timeRange = encodeURIComponent(JSON.stringify({ since: dateStr, until: dateStr }))
  const url = `https://graph.facebook.com/v21.0/act_${META_AD_ACCOUNT_ID}/insights?fields=actions&time_range=${timeRange}&access_token=${encodeURIComponent(token)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    const data = (await res.json()) as {
      data?: { actions?: { action_type: string; value: string }[] }[]
      error?: { message: string }
    }
    if (!res.ok || data.error) {
      throw new Error(data.error?.message || `http_${res.status}`)
    }
    const actions = data.data?.[0]?.actions || []
    const purchase = actions.find((a) => a.action_type === "purchase")
    return purchase ? Number(purchase.value) || 0 : 0
  } finally {
    clearTimeout(timer)
  }
}

export default async (_req: Request, _ctx: Context): Promise<Response> => {
  const dateStr = daysAgoInArgentina(1)

  let sheetCount: number
  let manualCount: number
  let metaCount: number
  try {
    const [orders, deliveries] = await Promise.all([fetchOrders(), listRecentDeliveries(500)])
    sheetCount = countSheetSales(orders, dateStr)
    manualCount = countManualSales(deliveries, dateStr)
    metaCount = await fetchMetaPurchaseCount(dateStr)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[daily-gap-report] no se pudo completar la comparación:", msg)
    await notifyDiscord(
      `gap-report-error-${dateStr}`,
      `⚠️ Reporte de brecha ${dateStr}: no se pudo completar la comparación (${msg}). Revisar logs de la función.`,
    )
    return Response.json({ ok: false, error: msg }, { status: 500 })
  }

  const realSales = sheetCount + manualCount
  const matched = realSales === metaCount

  console.log(
    `[daily-gap-report] ${dateStr}: reales=${realSales} (sheet=${sheetCount}, manual=${manualCount}) meta=${metaCount} match=${matched}`,
  )

  if (!matched) {
    await notifyDiscord(
      `gap-report-${dateStr}`,
      `🟡 Reporte de brecha ${dateStr}: ${realSales} ventas reales (${sheetCount} del Sheet + ${manualCount} manuales) vs ${metaCount} que Meta contó como Purchase. Revisar Events Manager.`,
    )
  }

  return Response.json({ ok: true, date: dateStr, sheetCount, manualCount, realSales, metaCount, matched })
}

export const config: Config = {
  // 12:00 UTC = 09:00 Argentina — deja margen para que el día anterior esté
  // cerrado del todo y para que las métricas de Meta ya hayan asentado.
  schedule: "0 12 * * *",
}
