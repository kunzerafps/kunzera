import type { Config, Context } from "@netlify/functions"
import type { Order } from "../../src/types/order"
import { dateOnlyInArgentina, daysAgoInArgentina } from "./lib/argentinaTime"
import { listRecentDeliveries } from "./lib/deliveryLog"
import { getSheetOrders } from "./lib/sheetOrders"
import { listManualSales, updateManualSaleByEvent } from "./lib/manualSalesStore"
import { getAttribution } from "./lib/attribution"
import { getPaymentMethod } from "./lib/facturacion"
import { sendMetaPurchaseEvent, MAX_EVENT_AGE_DAYS } from "./lib/metaCapi"
import { notifyDiscord } from "./lib/discordAlert"

// Corre todos los días (09:00 Argentina) y REENVÍA a Meta cualquier venta real
// que no le haya llegado como evento de Compra. No es un "reporte" que hay que
// leer: repara solo. Discord solo se toca si algo NO se pudo reenviar (eso sí
// es un problema real) o si no se pudo leer el Sheet.
//
// Por qué "reenviar todo lo que falta" en vez de comparar contra lo que Meta
// dice haber contado: Meta solo cuenta como "compra de anuncio" las ventas que
// pudo atribuir a un clic reciente. Una venta orgánica, o una por WhatsApp, o
// una de alguien que clickeó el anuncio hace más de una semana, es una venta
// real que NO aparece en ese número — comparar contra él daba una "brecha"
// falsa casi todos los días. Lo que importa es si el EVENTO le llegó a Meta,
// y eso se sabe con el log de entregas (deliveryLog) + la dedup de metaCapi.
//
// Ventana: de hace 9 días a hace 2 días. Se deja 1 día de gracia porque para
// transferencia/binance el evento se manda recién cuando el admin marca
// "atendido" (puede ser 24-48hs después de la reserva). No se toca "hoy" ni
// "ayer" para no reenviar algo que todavía está en curso.
const WINDOW_FROM_DAYS = 9
const WINDOW_TO_DAYS = 2

// Tope de seguridad: si de golpe faltan MÁS de esto, casi seguro se rompió
// algo sistémico (el store de dedup se borró, el Sheet devuelve basura) — NO
// se bombardea a Meta con decenas de eventos viejos, se avisa y listo.
const MAX_RESEND_PER_RUN = 10

const VENTA_ESTADOS = new Set(["confirmado", "atendido"])

function inWindow(dateStr: string, from: string, to: string): boolean {
  return dateStr >= from && dateStr <= to
}

// Unix seconds para el evento: la fecha real de la venta si está dentro de la
// ventana de 7 días que acepta Meta; si es más vieja, `undefined` → metaCapi
// usa "ahora" (evento mal fechado, pero mejor que perderlo).
function eventTimeWithinWindow(ms: number): number | undefined {
  const ageDays = (Date.now() - ms) / (24 * 60 * 60 * 1000)
  if (ageDays < 0 || ageDays > MAX_EVENT_AGE_DAYS) return undefined
  return Math.floor(ms / 1000)
}

type Missing = { label: string; kind: "sitio" | "manual" }

export default async (_req: Request, _ctx: Context): Promise<Response> => {
  const from = daysAgoInArgentina(WINDOW_FROM_DAYS)
  const to = daysAgoInArgentina(WINDOW_TO_DAYS)

  // Sheet: se tolera que falle (Apps Script es intermitente) — igual se
  // reconcilian las ventas manuales, y se avisa aparte que no se pudo leer.
  const [ordersRes, manualSales, deliveries] = await Promise.all([
    getSheetOrders({ attempts: 2, timeoutMs: 6000 }).then(
      (o) => ({ ok: true as const, orders: o }),
      (e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }),
    ),
    listManualSales(500).catch(() => [] as Awaited<ReturnType<typeof listManualSales>>),
    listRecentDeliveries(1000).catch(() => []),
  ])

  const sheetOk = ordersRes.ok && ordersRes.orders.length > 0
  const orders: Order[] = ordersRes.ok ? ordersRes.orders : []

  // event_id de toda venta que YA le llegó a Meta (o que Meta ya tenía y
  // dedup local descartó). Contra esto se decide qué reenviar.
  const deliveredOk = new Set(
    deliveries.filter((d) => d.ok || d.dedupedLocally).map((d) => d.eventId),
  )

  // ── Ventas del sitio (Sheet) que faltan ──
  const missingSite = orders.filter((o) => {
    if (!VENTA_ESTADOS.has(String(o.estado || "").toLowerCase())) return false
    if (!o.idempotencykey) return false
    if (!inWindow(dateOnlyInArgentina(o.timestamp), from, to)) return false
    return !deliveredOk.has(o.idempotencykey)
  })

  // ── Ventas manuales (WhatsApp) que faltan ──
  const missingManual = manualSales.filter((m) => {
    if (m.canceled) return false
    if (!inWindow(m.saleDate, from, to)) return false
    return !deliveredOk.has(m.metaEventId)
  })

  const totalMissing = missingSite.length + missingManual.length

  // Nada que hacer → silencio total (salvo que el Sheet no se haya podido leer).
  if (totalMissing === 0) {
    if (!ordersRes.ok || !sheetOk) {
      await notifyDiscord(
        `gap-sheet-unreadable-${to}`,
        `⚠️ No se pudieron leer las reservas del Sheet para revisar que las ventas hayan llegado a Meta. Las ventas por WhatsApp sí se revisaron. Revisar Apps Script.`,
      )
    }
    console.log(`[reconcile] ${from}..${to}: sin faltantes (sheetOk=${sheetOk})`)
    return Response.json({ ok: true, from, to, resent: 0, failed: 0, sheetOk })
  }

  // Demasiadas faltantes de golpe → no reenviar en masa, avisar.
  if (totalMissing > MAX_RESEND_PER_RUN) {
    await notifyDiscord(
      `gap-too-many-${to}`,
      `⚠️ Figuran ${totalMissing} ventas sin llegar a Meta entre ${from} y ${to} (${missingSite.length} del sitio, ${missingManual.length} manuales). Es demasiado — probablemente se rompió algo (el registro de envíos, o la lectura del Sheet). NO se reenviaron para no duplicar. Revisar antes de forzar.`,
    )
    console.error(`[reconcile] ${totalMissing} faltantes — sobre el tope, no se reenvía`)
    return Response.json({ ok: false, from, to, tooMany: totalMissing }, { status: 200 })
  }

  const resent: Missing[] = []
  const failed: Missing[] = []
  const skipped: Missing[] = []

  // ── Reenviar ventas del sitio ──
  for (const o of missingSite) {
    const key = o.idempotencykey!
    const label = `${o.nombre || "-"} (${dateOnlyInArgentina(o.timestamp)}, $${o.monto})`
    const value = Number(o.monto) || 0
    if (value <= 0) {
      skipped.push({ label: `${label} — monto inválido`, kind: "sitio" })
      continue
    }
    try {
      const [metodo, attribution] = await Promise.all([
        getPaymentMethod(key),
        getAttribution(key),
      ])
      const result = await sendMetaPurchaseEvent({
        eventId: key,
        source: metodo === "mercadopago" ? "mercadopago" : "transferencia_binance",
        actionSource: "website",
        value,
        contentName: o.plan,
        whatsapp: o.whatsapp,
        nombre: o.nombre,
        fbp: attribution?.fbp,
        fbc: attribution?.fbc,
        clientIpAddress: attribution?.ip,
        clientUserAgent: attribution?.userAgent,
        city: attribution?.city,
        region: attribution?.region,
        postalCode: attribution?.postalCode,
        countryCode: attribution?.countryCode,
        externalId: attribution?.visitorId,
        eventTime: eventTimeWithinWindow(new Date(o.timestamp).getTime()),
      })
      ;(result.ok ? resent : failed).push({ label, kind: "sitio" })
    } catch (err) {
      console.error("[reconcile] error reenviando venta del sitio", key, err)
      failed.push({ label, kind: "sitio" })
    }
  }

  // ── Reenviar ventas manuales ──
  for (const m of missingManual) {
    const label = `${m.nombre} (${m.id}, ${m.saleDate}, $${m.monto})`
    const value = Number(m.monto) || 0
    if (value <= 0) {
      skipped.push({ label: `${label} — monto inválido`, kind: "manual" })
      continue
    }
    try {
      const middayMs = new Date(`${m.saleDate}T15:00:00Z`).getTime()
      const result = await sendMetaPurchaseEvent({
        eventId: m.metaEventId,
        source: "venta_manual",
        actionSource: "business_messaging",
        value,
        contentName: m.pack,
        whatsapp: m.whatsapp,
        nombre: m.nombre,
        email: m.email || undefined,
        countryCode: "ar",
        eventTime: eventTimeWithinWindow(middayMs),
        saleDate: m.saleDate,
      })
      if (result.ok) {
        resent.push({ label, kind: "manual" })
        // Reflejar en el panel que ya está OK.
        await updateManualSaleByEvent(m.metaEventId, { metaStatus: "ok", metaError: undefined }).catch(
          () => {},
        )
      } else {
        failed.push({ label, kind: "manual" })
      }
    } catch (err) {
      console.error("[reconcile] error reenviando venta manual", m.metaEventId, err)
      failed.push({ label, kind: "manual" })
    }
  }

  console.log(
    `[reconcile] ${from}..${to}: reenviadas=${resent.length} fallaron=${failed.length} saltadas=${skipped.length}`,
  )

  // Discord: SOLO si hay algo que el robot no pudo arreglar solo.
  const problemas: string[] = []
  if (failed.length > 0) {
    problemas.push(
      `❌ No se pudieron reenviar ${failed.length} venta(s) a Meta:\n` +
        failed.map((f) => `• ${f.label} [${f.kind}]`).join("\n"),
    )
  }
  if (skipped.length > 0) {
    problemas.push(
      `⚠️ ${skipped.length} venta(s) con monto inválido — revisar en la planilla:\n` +
        skipped.map((s) => `• ${s.label}`).join("\n"),
    )
  }
  if (!ordersRes.ok || !sheetOk) {
    problemas.push("⚠️ No se pudieron leer las reservas del Sheet (Apps Script) — solo se revisaron las manuales.")
  }

  if (problemas.length > 0) {
    await notifyDiscord(`gap-problems-${to}`, problemas.join("\n\n"))
  } else if (resent.length > 0) {
    // Aviso corto de "ya lo arreglé" — no requiere que hagas nada.
    await notifyDiscord(
      `gap-fixed-${to}`,
      `✅ Reenvié ${resent.length} venta(s) que no habían llegado a Meta (ya está resuelto, no hace falta que hagas nada):\n` +
        resent.map((r) => `• ${r.label} [${r.kind}]`).join("\n"),
    )
  }

  return Response.json({
    ok: failed.length === 0,
    from,
    to,
    resent: resent.length,
    failed: failed.length,
    skipped: skipped.length,
    sheetOk,
  })
}

export const config: Config = {
  // 12:00 UTC = 09:00 Argentina.
  schedule: "0 12 * * *",
}
