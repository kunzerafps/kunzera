import type { Config, Context } from "@netlify/functions"
import type { Order } from "../../src/types/order"
import { listRecentDeliveries } from "./lib/deliveryLog"
import { getSheetOrders } from "./lib/sheetOrders"
import { listManualSales, updateManualSaleByEvent } from "./lib/manualSalesStore"
import { getAttribution } from "./lib/attribution"
import { getPaymentMethod } from "./lib/facturacion"
import { sendMetaPurchaseEvent, MAX_EVENT_AGE_DAYS } from "./lib/metaCapi"
import { notifyDiscord } from "./lib/discordAlert"

// Corre 1 vez por día (09:00 Argentina). NO es un reporte para leer: repara
// solo. Por cada venta que YA le tendría que haber llegado a Meta y no le
// llegó, se la reenvía. Meta deduplica del otro lado por event_id, así que
// reenviar de más NO cuenta la venta dos veces.
//
// "Ya le tendría que haber llegado" se define por el ESTADO de la venta, no
// por una fecha — alguien puede pagar hoy y tener el turno en 2 semanas, así
// que "cuándo se cargó" no dice nada:
//   · Reserva del sitio marcada "atendido" en el panel. Ese click es lo que
//     dispara el aviso a Meta para transferencia/binance; para Mercado Pago
//     el aviso ya salió al momento de pagar. Si la reserva está atendida, el
//     evento de Compra tuvo que haber salido sí o sí.
//   · Venta manual por WhatsApp cuyo aviso a Meta no figura entregado.
//
// La verdad de "salió o no" es el log de entregas (deliveryLog): se marca
// entregada si Meta la aceptó, o si la dedup local vio que Meta ya la tenía.
//
// Discord SOLO se toca si algo NO se pudo reenviar (problema real que
// necesita tu mano) o si no se pudo leer la planilla. Si reenvió algo y todo
// salió bien, manda un aviso corto de "ya está" que no requiere que hagas
// nada.

// Tope de seguridad: si de golpe faltan MÁS de esto, casi seguro se rompió
// algo sistémico (el registro de envíos se borró, la planilla devuelve
// basura) — NO se bombardea a Meta con decenas de eventos, se avisa y listo.
const MAX_RESEND_PER_RUN = 10

// event_time del evento reenviado: la fecha del turno (lo más cercano a
// "cuándo se atendió y debió dispararse el aviso"), si entra en la ventana
// de 7 días que Meta acepta hacia atrás. Si es más viejo → undefined y
// metaCapi usa "ahora" (evento mal fechado, pero mejor que perder la venta).
function eventTimeOrNow(ms: number): number | undefined {
  if (!Number.isFinite(ms)) return undefined
  const ageDays = (Date.now() - ms) / 86_400_000
  if (ageDays < 0 || ageDays > MAX_EVENT_AGE_DAYS) return undefined
  return Math.floor(ms / 1000)
}

type Missing = { label: string; kind: "sitio" | "manual" }

export default async (_req: Request, _ctx: Context): Promise<Response> => {
  // La planilla puede fallar (Apps Script es intermitente) — igual se
  // reconcilian las ventas manuales, y se avisa aparte que no se pudo leer.
  const [ordersRes, manualSales, deliveries] = await Promise.all([
    getSheetOrders({ attempts: 2, timeoutMs: 6000 }).then(
      (o) => ({ ok: true as const, orders: o }),
      (e) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }),
    ),
    listManualSales(500).catch(() => [] as Awaited<ReturnType<typeof listManualSales>>),
    // Tope alto a propósito: el chequeo es contra el estado de la venta, no
    // contra una ventana de fechas — una entrega vieja tiene que seguir
    // contando como "ya avisada".
    listRecentDeliveries(10000).catch(() => []),
  ])

  const sheetOk = ordersRes.ok && ordersRes.orders.length > 0
  const orders: Order[] = ordersRes.ok ? ordersRes.orders : []

  // event_id de toda venta que YA le llegó a Meta (o que Meta ya tenía y la
  // dedup local descartó). Contra esto se decide qué reenviar.
  const deliveredOk = new Set(
    deliveries.filter((d) => d.ok || d.dedupedLocally).map((d) => d.eventId),
  )

  // ── Reservas del sitio marcadas "atendido" cuyo evento no figura enviado ──
  const missingSite = orders.filter((o) => {
    if (String(o.estado || "").toLowerCase() !== "atendido") return false
    if (!o.idempotencykey) return false
    return !deliveredOk.has(o.idempotencykey)
  })

  // ── Ventas manuales (WhatsApp) sin cancelar cuyo evento no figura enviado ──
  const missingManual = manualSales.filter((m) => {
    if (m.canceled) return false
    return !deliveredOk.has(m.metaEventId)
  })

  const totalMissing = missingSite.length + missingManual.length

  // Nada que hacer → silencio total (salvo que la planilla no se haya podido leer).
  if (totalMissing === 0) {
    if (!ordersRes.ok || !sheetOk) {
      await notifyDiscord(
        "gap-sheet-unreadable",
        "⚠️ No se pudieron leer las reservas de la planilla para revisar que las ventas hayan llegado a Meta. Las ventas por WhatsApp sí se revisaron. Revisar Apps Script.",
      )
    }
    console.log(`[reconcile] sin faltantes (sheetOk=${sheetOk})`)
    return Response.json({ ok: true, resent: 0, failed: 0, skipped: 0, sheetOk })
  }

  // Demasiadas faltantes de golpe → no reenviar en masa, avisar.
  if (totalMissing > MAX_RESEND_PER_RUN) {
    await notifyDiscord(
      "gap-too-many",
      `⚠️ Figuran ${totalMissing} ventas atendidas sin llegar a Meta (${missingSite.length} del sitio, ${missingManual.length} manuales). Es demasiado — probablemente se rompió algo (el registro de envíos, o la lectura de la planilla). NO se reenviaron para no duplicar. Revisar antes de forzar.`,
    )
    console.error(`[reconcile] ${totalMissing} faltantes — sobre el tope, no se reenvía`)
    return Response.json({ ok: false, tooMany: totalMissing, sheetOk }, { status: 200 })
  }

  const resent: Missing[] = []
  const failed: Missing[] = []
  const skipped: Missing[] = []

  // ── Reenviar reservas del sitio ──
  for (const o of missingSite) {
    const key = o.idempotencykey!
    const label = `${o.nombre || "-"} (turno ${String(o.turno || "").slice(0, 10) || "?"}, $${o.monto})`
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
        eventTime: eventTimeOrNow(new Date(o.turno).getTime()),
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
        eventTime: eventTimeOrNow(middayMs),
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
    `[reconcile] reenviadas=${resent.length} fallaron=${failed.length} saltadas=${skipped.length}`,
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
    problemas.push("⚠️ No se pudieron leer las reservas de la planilla (Apps Script) — solo se revisaron las manuales.")
  }

  if (problemas.length > 0) {
    await notifyDiscord("gap-problems", problemas.join("\n\n"))
  } else if (resent.length > 0) {
    // Aviso corto de "ya lo arreglé" — no requiere que hagas nada.
    await notifyDiscord(
      "gap-fixed",
      `✅ Reenvié ${resent.length} venta(s) que no habían llegado a Meta (ya está resuelto, no hace falta que hagas nada):\n` +
        resent.map((r) => `• ${r.label} [${r.kind}]`).join("\n"),
    )
  }

  return Response.json({
    ok: failed.length === 0,
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
