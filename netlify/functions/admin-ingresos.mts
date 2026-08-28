import type { Config, Context } from "@netlify/functions"
import type { Order } from "../../src/types/order"
import { verifySessionToken } from "./lib/adminSession"
import { dateOnlyInArgentina, daysAgoInArgentina } from "./lib/argentinaTime"
import { getSheetOrders } from "./lib/sheetOrders"
import { listManualSales, type ManualSale } from "./lib/manualSalesStore"
import { fetchAdSpend, type AdSpend } from "./lib/metaAdSpend"

// Vista de solo lectura que JUNTA en un lado: ventas web (Sheet, ya
// confirmadas) + ventas por WhatsApp (registro manual) + gasto de anuncios
// de Meta. No es una fuente de verdad nueva ni migra nada — arma los números
// al vuelo cada vez que se pide. Para el panel "Ingresos".
//
// Límites conocidos de esta v1 (ver también el recap):
//  - "venta web" = reserva con estado confirmado/atendido. Las pendientes no
//    cuentan (todavía no generaron Compra en Meta).
//  - No resta reintegros ni cancelaciones de ventas web (el Sheet no las
//    marca). Las ventas manuales canceladas SÍ se excluyen.
//  - El desglose por campaña es solo de las ventas de WhatsApp (el Sheet no
//    guarda de qué campaña vino cada reserva). El "retorno" por campaña es
//    orientativo: cruza el nombre de campaña que cargó el admin contra el
//    nombre en Meta, y no siempre coinciden exacto.

const MAX_DAYS = 180
const DEFAULT_DAYS = 30

function normalizePhone(raw: string): string {
  let d = (raw || "").replace(/\D/g, "")
  if (d.startsWith("549")) d = d.slice(3)
  else if (d.startsWith("54") && d.length > 10) d = d.slice(2)
  if (d.startsWith("0")) d = d.slice(1)
  return d
}

function esVentaWeb(o: Order): boolean {
  const e = String(o.estado || "").toLowerCase()
  return e === "confirmado" || e === "atendido"
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  const url = new URL(req.url)
  const token = req.method === "GET" ? url.searchParams.get("token") : null
  if (!verifySessionToken(token)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }

  const daysParam = Number(url.searchParams.get("days"))
  const dias = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(Math.floor(daysParam), MAX_DAYS) : DEFAULT_DAYS
  const desde = daysAgoInArgentina(dias - 1) // incluye hoy
  const hasta = daysAgoInArgentina(0)

  let orders: Order[]
  let manuales: ManualSale[]
  let spend: AdSpend | null = null
  let spendError: string | undefined
  try {
    // El gasto de Meta puede fallar (token/permiso/red) sin que eso tumbe
    // toda la vista — se muestra el resto y se avisa que el gasto no cargó.
    const [o, m, s] = await Promise.all([
      getSheetOrders(),
      listManualSales(1000),
      fetchAdSpend(desde, hasta).catch((e) => {
        spendError = e instanceof Error ? e.message : String(e)
        return null
      }),
    ])
    orders = o
    manuales = m
    spend = s
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }

  // ---- ventas web (Sheet) ----
  const webVentas = orders.filter((o) => esVentaWeb(o) && dateOnlyInArgentina(o.timestamp) >= desde)
  const webIngresos = webVentas.reduce((s, o) => s + (Number(o.monto) || 0), 0)

  // ---- ventas WhatsApp (registro manual) ----
  const waVentas = manuales.filter((v) => !v.canceled && v.saleDate >= desde && v.saleDate <= hasta)
  const waIngresos = waVentas.reduce((s, v) => s + (Number(v.monto) || 0), 0)

  // ---- por campaña (solo WhatsApp) ----
  const porCampanaMap = new Map<string, { ventas: number; ingresos: number }>()
  for (const v of waVentas) {
    const key = (v.campania || "sin campaña").trim() || "sin campaña"
    const cur = porCampanaMap.get(key) || { ventas: 0, ingresos: 0 }
    cur.ventas++
    cur.ingresos += Number(v.monto) || 0
    porCampanaMap.set(key, cur)
  }
  const gastoPorNombre = new Map<string, number>()
  if (spend) {
    for (const [name, g] of Object.entries(spend.porCampana)) {
      gastoPorNombre.set(name.trim().toLowerCase(), g)
    }
  }
  const porCampana = Array.from(porCampanaMap.entries())
    .map(([campana, x]) => {
      const gasto = gastoPorNombre.get(campana.toLowerCase())
      return {
        campana,
        ventas: x.ventas,
        ingresos: Math.round(x.ingresos),
        gasto: gasto !== undefined ? Math.round(gasto * 100) / 100 : null,
        retorno: gasto && gasto > 0 ? Math.round((x.ingresos / gasto) * 100) / 100 : null,
      }
    })
    .sort((a, b) => b.ingresos - a.ingresos)

  // ---- recompra / LTV (item 17): agrupa web + WhatsApp por teléfono ----
  const porCliente = new Map<string, { ventas: number; ingresos: number }>()
  for (const o of webVentas) {
    const k = normalizePhone(o.whatsapp)
    if (!k) continue
    const c = porCliente.get(k) || { ventas: 0, ingresos: 0 }
    c.ventas++
    c.ingresos += Number(o.monto) || 0
    porCliente.set(k, c)
  }
  for (const v of waVentas) {
    const k = normalizePhone(v.whatsapp)
    if (!k) continue
    const c = porCliente.get(k) || { ventas: 0, ingresos: 0 }
    c.ventas++
    c.ingresos += Number(v.monto) || 0
    porCliente.set(k, c)
  }
  let clientesQueVolvieron = 0
  let ventasDeRecompra = 0
  let ingresosDeRecompra = 0
  let ingresoPromedioPorCliente = 0
  for (const c of porCliente.values()) {
    if (c.ventas > 1) {
      clientesQueVolvieron++
      ventasDeRecompra += c.ventas - 1
      // ingreso de este cliente MENOS su primera compra (aprox: promedio)
      ingresosDeRecompra += c.ingresos * ((c.ventas - 1) / c.ventas)
    }
    ingresoPromedioPorCliente += c.ingresos
  }
  const clientesUnicos = porCliente.size
  if (clientesUnicos > 0) ingresoPromedioPorCliente = ingresoPromedioPorCliente / clientesUnicos

  const ingresos = Math.round(webIngresos + waIngresos)
  const gasto = spend ? spend.total : null

  return Response.json({
    ok: true,
    rango: { desde, hasta, dias },
    web: { ventas: webVentas.length, ingresos: Math.round(webIngresos) },
    whatsapp: { ventas: waVentas.length, ingresos: Math.round(waIngresos) },
    meta: { gasto, moneda: spend?.currency || "ARS", error: spendError || null },
    totales: {
      ingresos,
      gasto,
      retorno: gasto && gasto > 0 ? Math.round((ingresos / gasto) * 100) / 100 : null,
    },
    porCampana,
    recompra: {
      clientesUnicos,
      clientesQueVolvieron,
      ventasDeRecompra,
      ingresosDeRecompra: Math.round(ingresosDeRecompra),
      ingresoPromedioPorCliente: Math.round(ingresoPromedioPorCliente),
    },
  })
}

export const config: Config = {
  path: "/api/admin-ingresos",
}
