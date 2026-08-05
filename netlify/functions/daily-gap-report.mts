import type { Config, Context } from "@netlify/functions"
import { APPS_SCRIPT_URL, ADMIN_SECRET_TOKEN } from "../../src/lib/constants"
import type { Order } from "../../src/types/order"
import { dateOnlyInArgentina, daysAgoInArgentina } from "./lib/argentinaTime"
import { listRecentDeliveries, type DeliveryLogEntry } from "./lib/deliveryLog"
import { notifyDiscord } from "./lib/discordAlert"

// Cuenta cuántas ventas reales hubo "ayer" (hora Argentina) según dos
// fuentes independientes de lo que se le mandó a Meta, y lo compara contra
// lo que Meta dice haber contado — el objetivo es detectar en silencio
// (Discord solo avisa si hay diferencia) si algo se rompió en la cadena de
// envío sin que nadie lo note por semanas.
const META_AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID || "215090675"

// Las Scheduled Functions de Netlify tienen un límite duro de ejecución de
// 30 segundos (a diferencia de las funciones normales, que corren bajo un
// límite más corto pero pueden llegar a Background Functions si hiciera
// falta más tiempo). Todo el presupuesto de reintentos de acá abajo está
// pensado para nunca superar ese techo ni siquiera en el peor caso —
// incluye el fetch de Meta DENTRO del mismo Promise.all que Apps Script
// (ver más abajo) para que corran en paralelo, no en serie.
const APPS_SCRIPT_ATTEMPTS = 3
const APPS_SCRIPT_TIMEOUT_MS = 7000
const APPS_SCRIPT_RETRY_WAIT_MS = 400
// Peor caso: 3 × 7s + 2 × 0.4s ≈ 21.8s, corriendo en paralelo con el fetch
// de Meta (10s) — bien por debajo de los 30s límite, con margen para el
// resto del handler.
const META_FETCH_TIMEOUT_MS = 10000

// Alias que Meta usa para reportar la MISMA compra bajo distintos recortes
// de atribución (confirmado con una llamada real a act_215090675/insights:
// todos aparecieron juntos con el mismo valor para la misma venta). No hay
// garantía documentada de que el alias plano "purchase" esté siempre
// presente — tomar el máximo entre estos alias (nunca la suma) evita tanto
// subcontar si "purchase" falta un día, como sobrecontar si aparecen varios
// a la vez (son la misma conversión vista de distintas formas, no eventos
// separados).
const PURCHASE_ACTION_TYPES = new Set([
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
  "onsite_web_purchase",
  "onsite_web_app_purchase",
  "web_in_store_purchase",
  "web_app_in_store_purchase",
])

// Mismo bug de CORS intermitente que appsScript.ts (getOrders) del lado del
// cliente — algunos intentos fallan solos, reintentar es más simple y más
// confiable que investigar el redirect de Apps Script a fondo. Presupuesto
// de reintentos recortado respecto al del cliente (que corre en el
// navegador, sin límite de tiempo real) porque acá SÍ hay un techo duro de
// 30s de Netlify — ver constantes arriba.
async function fetchOrders(): Promise<Order[]> {
  const url = `${APPS_SCRIPT_URL}?action=getOrders&token=${encodeURIComponent(ADMIN_SECRET_TOKEN)}`
  let lastErr = "unknown"
  for (let attempt = 0; attempt < APPS_SCRIPT_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, APPS_SCRIPT_RETRY_WAIT_MS))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), APPS_SCRIPT_TIMEOUT_MS)
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
//
// Límite conocido y aceptado (no tiene arreglo limpio sin agregar un campo
// nuevo al Sheet): si una transferencia/binance tarda más de
// MAX_EVENT_AGE_DAYS (7 días, ver metaCapi.ts) en confirmarse,
// capi-confirmar-pago.mts manda el Purchase a Meta con event_time = "ahora"
// (el momento de la confirmación), no con la fecha de creación de la
// reserva — pero acá abajo se sigue filtrando por `o.timestamp` (fecha de
// CREACIÓN), porque el Sheet no guarda por separado "cuándo se confirmó".
// Esa venta puntual queda invisible para sheetCount en cualquier día
// posible, y el día que Meta la cuenta ("ahora") va a generar una brecha
// real que no es un bug de tracking sino este caso conocido. Pasa solo
// cuando el admin tarda más de una semana en confirmar un comprobante —
// poco frecuente, pero si el aviso de Discord no tiene otra explicación
// más obvia, revisar primero si hay una confirmación tardía de ese estilo.
function countSheetSales(orders: Order[], dateStr: string): number {
  return orders.filter((o) => {
    const estado = String(o.estado || "").toLowerCase()
    const esVenta = estado === "confirmado" || estado === "atendido"
    return esVenta && dateOnlyInArgentina(o.timestamp) === dateStr
  }).length
}

// Ventas manuales (cerradas por WhatsApp, sin reserva en el Sheet) que sí se
// mandaron a Meta ese día — quedan solo en el log de entregas, ver
// deliveryLog.ts. Usa `saleDate` (la fecha real de la venta, ver
// capi-venta-manual.mts) cuando está disponible; para entradas viejas que
// se generaron antes de que ese campo existiera, cae a `lastAttemptAt`
// (cuándo el admin la cargó en el panel) como aproximación.
function countManualSales(entries: DeliveryLogEntry[], dateStr: string): number {
  return entries.filter((e) => {
    if (e.source !== "venta_manual" || !e.ok || e.dedupedLocally) return false
    const day = e.saleDate || dateOnlyInArgentina(e.lastAttemptAt)
    return day === dateStr
  }).length
}

async function fetchMetaPurchaseCount(dateStr: string): Promise<number> {
  const token = process.env.META_MARKETING_ACCESS_TOKEN
  if (!token) throw new Error("META_MARKETING_ACCESS_TOKEN no está configurado")

  const timeRange = encodeURIComponent(JSON.stringify({ since: dateStr, until: dateStr }))
  const url = `https://graph.facebook.com/v21.0/act_${META_AD_ACCOUNT_ID}/insights?fields=actions&time_range=${timeRange}&access_token=${encodeURIComponent(token)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), META_FETCH_TIMEOUT_MS)
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
    let max = 0
    for (const a of actions) {
      if (!PURCHASE_ACTION_TYPES.has(a.action_type)) continue
      const v = Number(a.value) || 0
      if (v > max) max = v
    }
    return max
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
    // Los tres fetches corren en paralelo a propósito — sumarlos en serie
    // (Apps Script primero, Meta después) puede superar el límite de 30s de
    // las Scheduled Functions de Netlify en el peor caso de reintentos.
    const [orders, deliveries, meta] = await Promise.all([
      fetchOrders(),
      listRecentDeliveries(500),
      fetchMetaPurchaseCount(dateStr),
    ])
    // 0 reservas en TODO el historial del Sheet (no solo ayer) es casi con
    // certeza un bug silencioso de Apps Script (nombre de hoja mal,
    // problema transitorio de la API de Sheets), no que el negocio nunca
    // tuvo ventas — tratarlo como error en vez de como "sheetCount=0"
    // evita mandar una alerta de "brecha de tracking" el día que el
    // problema real es mucho más grave (no se está leyendo el Sheet).
    if (orders.length === 0) {
      throw new Error("Apps Script devolvió 0 reservas en total (posible falla silenciosa, no un día sin ventas)")
    }
    sheetCount = countSheetSales(orders, dateStr)
    manualCount = countManualSales(deliveries, dateStr)
    metaCount = meta
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[daily-gap-report] no se pudo completar la comparación:", msg)
    // No se manda `msg` crudo a Discord: en teoría podría filtrar un token
    // si el error viniera de un fetch con URL malformada (no alcanzable con
    // el código actual, pero barato de evitar). El detalle completo queda
    // en los logs de la función, que ya son server-side.
    await notifyDiscord(
      `gap-report-error-${dateStr}`,
      `⚠️ El reporte de brecha del ${dateStr} no se pudo calcular (problema técnico leyendo el Sheet o Meta). No hace falta que hagas nada — quedó registrado en los logs para revisar.`,
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
      `🟡 Reporte de brecha ${dateStr}: ${realSales} ventas reales (${sheetCount} del Sheet + ${manualCount} manuales) vs ${metaCount} que Meta contó. Esto afecta cómo Meta optimiza tus anuncios, no tus reservas ni tus cobros reales. No hace falta que hagas nada — es un aviso interno para revisar el envío de eventos a Meta.`,
    )
  }

  return Response.json({ ok: true, date: dateStr, sheetCount, manualCount, realSales, metaCount, matched })
}

export const config: Config = {
  // 12:00 UTC = 09:00 Argentina — deja margen para que el día anterior esté
  // cerrado del todo y para que las métricas de Meta ya hayan asentado.
  schedule: "0 12 * * *",
}
