import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeGetStore, resetBlobsMock } from "./helpers/blobsMock"
import { installFetchMock, jsonResponse } from "./helpers/fetchMock"

vi.mock("@netlify/blobs", () => ({ getStore: (name: string) => fakeGetStore(name) }))

const { createSessionToken } = await import("../lib/adminSession")
const { saveAttribution } = await import("../lib/attribution")
const { listRecentDeliveries } = await import("../lib/deliveryLog")
const { default: confirmarPagoHandler } = await import("../capi-confirmar-pago.mts")

// La IP de este Context es la del ADMIN (quien llama a este endpoint desde
// el panel al confirmar el pago) — nunca debe terminar siendo la IP que se
// le manda a Meta como "IP del comprador".
const FAKE_CTX = { ip: "200.1.2.3" } as any

function req(body: Record<string, unknown>) {
  return new Request("https://kunzera.com/api/capi-confirmar-pago", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

// Desde G2 este endpoint manda DOS eventos por confirmación: Purchase y
// Schedule (reserva confirmada). Helpers para assertar sobre cada uno.
function metaEvent(fm: ReturnType<typeof installFetchMock>, name: string) {
  const call = fm
    .callsTo("graph.facebook.com")
    .find((c) => JSON.parse(String(c.init?.body)).data[0].event_name === name)
  return call ? JSON.parse(String(call.init?.body)).data[0] : undefined
}
function metaEventCount(fm: ReturnType<typeof installFetchMock>, name: string): number {
  return fm
    .callsTo("graph.facebook.com")
    .filter((c) => JSON.parse(String(c.init?.body)).data[0].event_name === name).length
}

describe("capi-confirmar-pago (transferencia/binance)", () => {
  let token: string

  beforeEach(() => {
    resetBlobsMock()
    process.env.ADMIN_SESSION_SECRET = "test-admin-secret"
    process.env.META_CAPI_ACCESS_TOKEN = "test-meta-token"
    delete process.env.MP_DISCORD_WEBHOOK_URL
    token = createSessionToken()!
  })

  it("transferencia confirmada genera un solo Purchase", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    const res = await confirmarPagoHandler(
      req({
        token,
        idempotencyKey: "transf-key-1",
        nombre: "Cliente Transferencia",
        whatsapp: "1122334455",
        plan: "platino",
        monto: 50000,
      }),
      FAKE_CTX,
    )
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(metaEventCount(fm, "Purchase")).toBe(1)
    // Schedule (reserva confirmada) sale junto con la Compra, con su propio
    // event_id "<key>-schedule".
    expect(metaEvent(fm, "Schedule")?.event_id).toBe("transf-key-1-schedule")
  })

  it("binance confirmado genera un solo Purchase (mismo endpoint, sin distinción de método)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    const res = await confirmarPagoHandler(
      req({
        token,
        idempotencyKey: "binance-key-1",
        nombre: "Cliente Binance",
        whatsapp: "1122334455",
        plan: "diamante",
        monto: 70000,
      }),
      FAKE_CTX,
    )
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(metaEventCount(fm, "Purchase")).toBe(1)
    expect(metaEventCount(fm, "Schedule")).toBe(1)
  })

  it("dos confirmaciones con el mismo idempotencyKey (doble-click) no duplican el Purchase", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    const body = {
      token,
      idempotencyKey: "doble-click-1",
      nombre: "Cliente Doble Click",
      whatsapp: "1122334455",
      plan: "platino",
      monto: 50000,
    }
    await confirmarPagoHandler(req(body), FAKE_CTX)
    await confirmarPagoHandler(req(body), FAKE_CTX) // segundo click, mismo idempotencyKey

    // Ni el Purchase ni el Schedule se duplican: los dos deduplican por su
    // propio event_id contra su store local.
    expect(metaEventCount(fm, "Purchase")).toBe(1)
    expect(metaEventCount(fm, "Schedule")).toBe(1)
  })

  it("usa el idempotencyKey recibido tal cual como event_id — no lo regenera", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await confirmarPagoHandler(
      req({
        token,
        idempotencyKey: "id-estable-xyz",
        nombre: "Cliente",
        whatsapp: "1122334455",
        plan: "platino",
        monto: 50000,
      }),
      FAKE_CTX,
    )

    // Purchase usa el idempotencyKey tal cual; Schedule le agrega "-schedule".
    expect(metaEvent(fm, "Purchase").event_id).toBe("id-estable-xyz")
    expect(metaEvent(fm, "Schedule").event_id).toBe("id-estable-xyz-schedule")
  })

  it("manda la IP/user-agent del COMPRADOR (capturados al reservar), nunca la del admin que confirma", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    // Simula lo que capture-attribution.mts ya guardó cuando el cliente
    // entró a pagar, con la IP/UA real del comprador — distinta a la del
    // admin (FAKE_CTX.ip = "200.1.2.3").
    await saveAttribution("ip-comprador-1", {
      ip: "190.10.20.30",
      userAgent: "Mozilla/5.0 (iPhone) ComprdorReal",
      capturedAt: Date.now(),
    })

    await confirmarPagoHandler(
      req({ token, idempotencyKey: "ip-comprador-1", nombre: "Cliente", monto: 50000 }),
      FAKE_CTX, // ip del ADMIN, no debería aparecer en el payload
    )

    const purchase = metaEvent(fm, "Purchase")
    expect(purchase.user_data.client_ip_address).toBe("190.10.20.30")
    expect(purchase.user_data.client_user_agent).toContain("ComprdorReal")
    // ninguno de los dos eventos filtra la IP del admin
    for (const c of fm.callsTo("graph.facebook.com")) {
      expect(String(c.init?.body)).not.toContain(FAKE_CTX.ip)
    }
  })

  it("por default (sin etiqueta de método de pago) registra la entrega como transferencia_binance", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await confirmarPagoHandler(
      req({ token, idempotencyKey: "sin-metodo-1", nombre: "Cliente", monto: 50000 }),
      FAKE_CTX,
    )

    const entries = await listRecentDeliveries(10)
    const entry = entries.find((e) => e.eventId === "sin-metodo-1")
    expect(entry?.source).toBe("transferencia_binance")
  })

  it("si la reserva está etiquetada como Mercado Pago (botón fusionado 'Marcar como atendido' llamado sobre un pedido de MP), registra la entrega con source='mercadopago', no transferencia_binance (bug real encontrado en auditoría: quedaba mal etiquetado)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    // Mismo store y mismo valor que mp-webhook.mts escribe vía
    // tagAsMercadoPago() cuando confirma un pago real de MP.
    await fakeGetStore("payment-methods").set("mp-order-1", "mercadopago")

    await confirmarPagoHandler(
      req({ token, idempotencyKey: "mp-order-1", nombre: "Cliente MP", monto: 70000 }),
      FAKE_CTX,
    )

    const entries = await listRecentDeliveries(10)
    const entry = entries.find((e) => e.eventId === "mp-order-1")
    expect(entry?.source).toBe("mercadopago")
  })

  it("rechaza sin token admin válido, sin llegar a llamar a Meta", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    const res = await confirmarPagoHandler(
      req({
        token: "token-invalido",
        idempotencyKey: "sin-auth-1",
        nombre: "X",
        monto: 50000,
      }),
      FAKE_CTX,
    )
    expect(res.status).toBe(401)
    expect(fm.callsTo("graph.facebook.com")).toHaveLength(0)
  })

  it("event_time usa el timestamp de la reserva, no 'ahora', cuando está dentro de los 7 días", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    const reservaTimestamp = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() // hace 2 días
    await confirmarPagoHandler(
      req({
        token,
        idempotencyKey: "evt-time-1",
        nombre: "Cliente",
        monto: 50000,
        reservaTimestamp,
      }),
      FAKE_CTX,
    )

    const expectedEventTime = Math.floor(new Date(reservaTimestamp).getTime() / 1000)
    // Purchase Y Schedule de la misma venta comparten el event_time real de la
    // reserva → caen en la misma ventana de atribución de Meta (G2).
    expect(metaEvent(fm, "Purchase").event_time).toBe(expectedEventTime)
    expect(metaEvent(fm, "Schedule").event_time).toBe(expectedEventTime)
  })

  it("manda el mail que la persona dejó en el chat, hasheado como `em` (era el dato que más faltaba: llegaba solo en el 40% de las compras)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    // Lo que capture-attribution guardó cuando el cliente entró a pagar. El
    // mail NO puede venir del Sheet: ahí el campo `email` es un honeypot
    // anti-spam (google-apps-script/Code.gs:108 rechaza la reserva entera).
    await saveAttribution("con-mail-1", {
      email: "comprador@gmail.com",
      capturedAt: Date.now(),
    })

    await confirmarPagoHandler(
      req({ token, idempotencyKey: "con-mail-1", nombre: "Cliente", monto: 50000 }),
      FAKE_CTX,
    )

    const em = metaEvent(fm, "Purchase").user_data.em
    expect(Array.isArray(em)).toBe(true)
    expect(em[0]).toMatch(/^[a-f0-9]{64}$/) // hasheado, nunca en texto plano
    for (const c of fm.callsTo("graph.facebook.com")) {
      expect(String(c.init?.body)).not.toContain("comprador@gmail.com")
    }
  })

  it("si la persona salteó el mail, la Compra sale igual, sin `em`", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await saveAttribution("sin-mail-1", { fbp: "fb.1.1.2", capturedAt: Date.now() })

    const res = await confirmarPagoHandler(
      req({ token, idempotencyKey: "sin-mail-1", nombre: "Cliente", monto: 50000 }),
      FAKE_CTX,
    )

    expect((await res.json()).ok).toBe(true)
    expect(metaEvent(fm, "Purchase").user_data.em).toBeUndefined()
  })

  // Schedule y Purchase son la MISMA venta, salen de la misma llamada y en el
  // mismo segundo. Antes el mail se le pasaba sólo al Purchase (Schedule ni
  // siquiera aceptaba el parámetro): medido el 6/09/2026, `em` llegaba al 80%
  // en Purchase y al 0% en Schedule, con calidad 9,0 contra 7,8. Este test es
  // el que impide que se vuelva a ir sin el dato.
  it("Schedule sale con el MISMO `em` hasheado que el Purchase de esa venta", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await saveAttribution("mail-schedule-1", {
      email: "  Comprador@Gmail.com ",
      capturedAt: Date.now(),
    })

    await confirmarPagoHandler(
      req({ token, idempotencyKey: "mail-schedule-1", nombre: "Cliente", monto: 50000 }),
      FAKE_CTX,
    )

    const purchaseEm = metaEvent(fm, "Purchase").user_data.em
    const scheduleEm = metaEvent(fm, "Schedule").user_data.em
    expect(Array.isArray(scheduleEm)).toBe(true)
    expect(scheduleEm[0]).toMatch(/^[a-f0-9]{64}$/)
    // Misma normalización (trim + minúsculas) ⇒ mismo hash exacto en los dos.
    expect(scheduleEm).toEqual(purchaseEm)
    // Y en texto plano no viaja en ninguno de los dos.
    for (const c of fm.callsTo("graph.facebook.com")) {
      expect(String(c.init?.body)).not.toContain("Comprador@Gmail.com")
    }
  })

  it("sin mail, el Schedule sale igual, sin `em`", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await saveAttribution("sin-mail-sched-1", { fbp: "fb.1.1.2", capturedAt: Date.now() })

    await confirmarPagoHandler(
      req({ token, idempotencyKey: "sin-mail-sched-1", nombre: "Cliente", monto: 50000 }),
      FAKE_CTX,
    )

    expect(metaEventCount(fm, "Schedule")).toBe(1)
    expect(metaEvent(fm, "Schedule").user_data.em).toBeUndefined()
  })

  it("markAtendido:true marca la reserva como atendido en la planilla y avisa a Meta en una sola llamada", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    fm.on("script.google.com", () => jsonResponse({ ok: true, row: 5, estado: "atendido" }))

    const res = await confirmarPagoHandler(
      req({
        token,
        idempotencyKey: "atender-1",
        nombre: "Cliente",
        whatsapp: "1122334455",
        plan: "platino",
        monto: 50000,
        markAtendido: true,
      }),
      FAKE_CTX,
    )
    const data = await res.json()
    expect(data.statusOk).toBe(true)
    expect(data.metaOk).toBe(true)
    expect(metaEventCount(fm, "Purchase")).toBe(1)

    const appsCall = fm.callsTo("script.google.com")[0]
    const sent = JSON.parse(String(appsCall.init?.body))
    expect(sent.action).toBe("updateStatus")
    expect(sent.estado).toBe("atendido")
    expect(sent.idempotencyKey).toBe("atender-1")
  })

  it("markAtendido:true — si la planilla falla, devuelve statusOk:false (error duro para el panel)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    fm.on("script.google.com", () => jsonResponse({ ok: false, error: "no_row" }))

    const res = await confirmarPagoHandler(
      req({ token, idempotencyKey: "atender-fail-1", nombre: "Cliente", monto: 50000, markAtendido: true }),
      FAKE_CTX,
    )
    const data = await res.json()
    expect(data.statusOk).toBe(false)
    expect(data.statusError).toBeTruthy()
  })

  it("markAtendido:true — si el aviso a Meta falla, la reserva IGUAL queda atendida (statusOk:true, metaOk:false)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({ error: { message: "bad" } }, 400))
    fm.on("script.google.com", () => jsonResponse({ ok: true, row: 5, estado: "atendido" }))

    const res = await confirmarPagoHandler(
      req({ token, idempotencyKey: "atender-meta-fail-1", nombre: "Cliente", monto: 50000, markAtendido: true }),
      FAKE_CTX,
    )
    const data = await res.json()
    expect(data.statusOk).toBe(true)
    expect(data.metaOk).toBe(false)
  })

  it("sin markAtendido (reintento de aviso / barrido) NO toca la planilla, solo reintenta el aviso a Meta", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    fm.on("script.google.com", () => jsonResponse({ ok: true }))

    const res = await confirmarPagoHandler(
      req({ token, idempotencyKey: "reintento-1", nombre: "Cliente", monto: 50000 }),
      FAKE_CTX,
    )
    const data = await res.json()
    expect(fm.callsTo("script.google.com")).toHaveLength(0)
    expect(data.statusOk).toBeUndefined()
    expect(data.metaOk).toBe(true)
  })

  it("event_time cae a 'ahora' si el timestamp de la reserva supera los 7 días (evita que Meta rechace el evento)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    const reservaTimestamp = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString() // hace 20 días
    const before = Math.floor(Date.now() / 1000)
    await confirmarPagoHandler(
      req({ token, idempotencyKey: "evt-time-old", nombre: "Cliente", monto: 50000, reservaTimestamp }),
      FAKE_CTX,
    )
    const after = Math.floor(Date.now() / 1000)

    for (const name of ["Purchase", "Schedule"]) {
      const ev = metaEvent(fm, name)
      expect(ev.event_time).toBeGreaterThanOrEqual(before)
      expect(ev.event_time).toBeLessThanOrEqual(after)
    }
  })
})
