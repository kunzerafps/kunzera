import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeGetStore, resetBlobsMock } from "./helpers/blobsMock"
import { installFetchMock, jsonResponse } from "./helpers/fetchMock"

vi.mock("@netlify/blobs", () => ({ getStore: (name: string) => fakeGetStore(name) }))

const { createSessionToken } = await import("../lib/adminSession")
const { default: ventaManualHandler } = await import("../capi-venta-manual.mts")
const { default: updateHandler } = await import("../capi-venta-manual-update.mts")
const { listManualSales } = await import("../lib/manualSalesStore")
const { default: funnelHandler } = await import("../capi-funnel.mts")

const FAKE_CTX = { ip: "200.1.2.3" } as any

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

let TOKEN: string

function createReq(body: Record<string, unknown>) {
  return new Request("https://kunzera.com/api/capi-venta-manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}
function updateReq(body: Record<string, unknown>) {
  return new Request("https://kunzera.com/api/capi-venta-manual-update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function cargarVenta(overrides: Record<string, unknown> = {}) {
  const res = await ventaManualHandler(
    createReq({
      token: TOKEN,
      nombre: "Cliente",
      whatsapp: "1155554444",
      email: "cliente@mail.com",
      monto: 50000,
      fecha: daysAgoISO(1),
      ...overrides,
    }),
    FAKE_CTX,
  )
  return res.json()
}

describe("capi-venta-manual-update", () => {
  beforeEach(() => {
    resetBlobsMock()
    process.env.ADMIN_SESSION_SECRET = "test-admin-secret"
    process.env.META_CAPI_ACCESS_TOKEN = "test-meta-token"
    delete process.env.MP_DISCORD_WEBHOOK_URL
    TOKEN = createSessionToken()!
  })

  it("cancelar marca la venta y reactivar la vuelve a activar", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const { id } = await cargarVenta()
    const [v] = await listManualSales()

    await updateHandler(updateReq({ token: TOKEN, eventId: v.metaEventId, action: "cancel" }), FAKE_CTX)
    expect((await listManualSales())[0].canceled).toBe(true)
    expect((await listManualSales())[0].id).toBe(id) // el id no cambia

    await updateHandler(updateReq({ token: TOKEN, eventId: v.metaEventId, action: "reactivate" }), FAKE_CTX)
    expect((await listManualSales())[0].canceled).toBe(false)
  })

  it("cancelar una venta que Meta recibió manda un evento CompraCancelada", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    await cargarVenta() // metaStatus "ok"
    const [v] = await listManualSales()

    fm.reset()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const res = await updateHandler(
      updateReq({ token: TOKEN, eventId: v.metaEventId, action: "cancel" }),
      FAKE_CTX,
    )
    const data = await res.json()
    expect(data.cancelMetaStatus).toBe("ok")

    const ev = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0]
    expect(ev.event_name).toBe("CompraCancelada")
    expect(ev.custom_data.order_id).toBe(v.metaEventId)
    expect((await listManualSales())[0].cancelMetaStatus).toBe("ok")
  })

  it("si el aviso de cancelación a Meta falla, la venta se cancela igual y queda cancelMetaStatus error", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    await cargarVenta() // metaStatus "ok"
    const [v] = await listManualSales()

    fm.reset()
    fm.on("graph.facebook.com", () => jsonResponse({ error: "caido" }, 500))
    const res = await updateHandler(
      updateReq({ token: TOKEN, eventId: v.metaEventId, action: "cancel" }),
      FAKE_CTX,
    )
    const data = await res.json()
    expect(data.ok).toBe(true) // la cancelación local SÍ se aplica
    expect(data.cancelMetaStatus).toBe("error")
    const [after] = await listManualSales()
    expect(after.canceled).toBe(true)
    expect(after.cancelMetaStatus).toBe("error")
  })

  it("retry-cancel-meta reintenta el aviso de cancelación y lo deja en ok", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    await cargarVenta()
    const [v] = await listManualSales()

    // cancelar con Meta caído -> cancelMetaStatus "error"
    fm.reset()
    fm.on("graph.facebook.com", () => jsonResponse({ error: "caido" }, 500))
    await updateHandler(updateReq({ token: TOKEN, eventId: v.metaEventId, action: "cancel" }), FAKE_CTX)
    expect((await listManualSales())[0].cancelMetaStatus).toBe("error")

    // Meta se recupera -> reintentar
    fm.reset()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const res = await updateHandler(
      updateReq({ token: TOKEN, eventId: v.metaEventId, action: "retry-cancel-meta" }),
      FAKE_CTX,
    )
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.cancelMetaStatus).toBe("ok")
    expect((await listManualSales())[0].cancelMetaStatus).toBe("ok")
  })

  it("retry-cancel-meta sobre una venta NO cancelada devuelve 409", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    await cargarVenta()
    const [v] = await listManualSales()

    const res = await updateHandler(
      updateReq({ token: TOKEN, eventId: v.metaEventId, action: "retry-cancel-meta" }),
      FAKE_CTX,
    )
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe("no_cancelada")
  })

  it("cancelar una venta que Meta NUNCA recibió no hace una llamada extra a Meta", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({ error: "meta caido" }, 500))
    await cargarVenta() // metaStatus "error" (la compra nunca llegó a Meta)
    const [v] = await listManualSales()

    fm.reset()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const res = await updateHandler(
      updateReq({ token: TOKEN, eventId: v.metaEventId, action: "cancel" }),
      FAKE_CTX,
    )
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.cancelMetaStatus).toBe("skipped") // no había nada que anular
    expect(fm.callsTo("graph.facebook.com")).toHaveLength(0)
    expect((await listManualSales())[0].canceled).toBe(true)
  })

  it("reintentar una venta pendiente que ahora sí entra deja el estado en ok", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({ error: "meta caido" }, 500))
    await cargarVenta()
    let [v] = await listManualSales()
    expect(v.metaStatus).toBe("error")

    // Meta se recupera
    fm.reset()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const res = await updateHandler(
      updateReq({ token: TOKEN, eventId: v.metaEventId, action: "retry-meta" }),
      FAKE_CTX,
    )
    const data = await res.json()
    expect(data.ok).toBe(true)
    ;[v] = await listManualSales()
    expect(v.metaStatus).toBe("ok")
  })

  it("no se puede reintentar una venta de más de 7 días", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({ error: "meta caido" }, 500))
    // cargarla con fecha de 6 días atrás (todavía válida al cargar)…
    await cargarVenta({ fecha: daysAgoISO(6) })
    const [v] = await listManualSales()

    // …y simular que ya pasaron varios días más antes de reintentar.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000))
    try {
      // Token nuevo bajo el reloj falso — el de beforeEach ya venció al
      // saltar la fecha.
      const freshToken = createSessionToken()!
      fm.reset()
      fm.on("graph.facebook.com", () => jsonResponse({}))
      const res = await updateHandler(
        updateReq({ token: freshToken, eventId: v.metaEventId, action: "retry-meta" }),
        FAKE_CTX,
      )
      const data = await res.json()
      expect(data.ok).toBe(false)
      expect(data.error).toBe("fecha_muy_vieja")
      expect(fm.callsTo("graph.facebook.com")).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("rechaza sin token de admin válido", async () => {
    const res = await updateHandler(
      updateReq({ token: "trucho", eventId: "x", action: "cancel" }),
      FAKE_CTX,
    )
    expect(res.status).toBe(401)
  })

  it("404 si la venta no existe", async () => {
    const res = await updateHandler(
      updateReq({ token: TOKEN, eventId: "no-existe", action: "cancel" }),
      FAKE_CTX,
    )
    expect(res.status).toBe(404)
  })

  it("no deja reintentar el aviso a Meta de una venta cancelada", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({ error: "meta caido" }, 500))
    await cargarVenta() // queda en metaStatus "error"
    const [v] = await listManualSales()
    await updateHandler(updateReq({ token: TOKEN, eventId: v.metaEventId, action: "cancel" }), FAKE_CTX)

    fm.reset()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const res = await updateHandler(
      updateReq({ token: TOKEN, eventId: v.metaEventId, action: "retry-meta" }),
      FAKE_CTX,
    )
    const data = await res.json()
    expect(res.status).toBe(409)
    expect(data.error).toBe("venta_cancelada")
    expect(fm.callsTo("graph.facebook.com")).toHaveLength(0)
  })

  it("reintentar una venta que ya está en ok es un noop (no re-llama a Meta)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    await cargarVenta() // metaStatus "ok"
    const [v] = await listManualSales()

    fm.reset()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const res = await updateHandler(
      updateReq({ token: TOKEN, eventId: v.metaEventId, action: "retry-meta" }),
      FAKE_CTX,
    )
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.noop).toBe(true)
    expect(fm.callsTo("graph.facebook.com")).toHaveLength(0)
  })

  it("si el reintento a Meta vuelve a fallar: 502 y el error queda actualizado en el registro", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({ error: "sigue caido" }, 500))
    await cargarVenta()
    const [v] = await listManualSales()

    const res = await updateHandler(
      updateReq({ token: TOKEN, eventId: v.metaEventId, action: "retry-meta" }),
      FAKE_CTX,
    )
    expect(res.status).toBe(502)
    const [after] = await listManualSales()
    expect(after.metaStatus).toBe("error")
    expect(after.metaError).toBeTruthy()
  })

  it("rechaza una acción desconocida y un eventId ausente", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    await cargarVenta()
    const [v] = await listManualSales()

    const bad1 = await updateHandler(
      updateReq({ token: TOKEN, eventId: v.metaEventId, action: "explotar" as any }),
      FAKE_CTX,
    )
    expect((await bad1.json()).error).toBe("accion_invalida")

    const bad2 = await updateHandler(updateReq({ token: TOKEN, action: "cancel" }), FAKE_CTX)
    expect((await bad2.json()).error).toBe("missing_event_id")
  })

  // El reintento mandaba un evento PEOR que el original: reconstruía la venta
  // desde el registro y no volvía a leer el índice por teléfono, así que iba
  // sin fbc/fbp/IP/geo/external_id ni campaña. Y es el camino que corre justo
  // cuando el primer envío falló — o sea, degradaba las ventas que más
  // necesitaban el rastro del anuncio para poder atribuirse.
  describe("retry-meta conserva el rastro del anuncio", () => {
    const CTX_COMPRADOR = {
      ip: "190.10.20.30",
      geo: {
        city: "Rosario",
        subdivision: { name: "Santa Fe" },
        postalCode: "2000",
        country: { code: "AR" },
      },
    } as any

    function leadReq(body: Record<string, unknown>) {
      return new Request("https://kunzera.com/api/capi-funnel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "user-agent": "Mozilla/5.0 (iPhone) Comprador",
        },
        body: JSON.stringify(body),
      })
    }

    function purchaseEnviado(fm: ReturnType<typeof installFetchMock>) {
      const calls = fm
        .callsTo("graph.facebook.com")
        .filter((c) => JSON.parse(String(c.init?.body)).data[0].event_name === "Purchase")
      return JSON.parse(String(calls[calls.length - 1].init?.body)).data[0]
    }

    it("el reintento lleva fbc, IP, geo, external_id y campaña", async () => {
      const fm = installFetchMock()
      // Meta falla mientras se carga la venta y anda cuando se reintenta.
      let metaCaida = false
      fm.on("graph.facebook.com", () =>
        metaCaida ? jsonResponse({ error: "boom" }, 500) : jsonResponse({}),
      )

      // 1) La persona pasó por el sitio y dejó su teléfono (evento Lead):
      //    ahí se guarda el rastro del clic del anuncio.
      await funnelHandler(
        leadReq({
          eventId: "lead-retry-1",
          event: "Lead",
          whatsapp: "1155554444",
          nombre: "Cliente Prueba",
          fbc: "fb.1.1700000000.ClicDelAnuncio",
          fbp: "fb.1.1700000000.987654321",
          externalId: "visitante-xyz",
        }),
        CTX_COMPRADOR,
      )

      // 2) La venta se cierra por WhatsApp y se carga a mano, pero Meta está
      //    caído: queda en "error".
      metaCaida = true
      await cargarVenta({ campania: "REELS AGOSTO" })
      const [v] = await listManualSales()
      expect(v.metaStatus).toBe("error")

      // 3) Se aprieta "Reintentar Meta".
      metaCaida = false
      const res = await updateHandler(
        updateReq({ token: TOKEN, eventId: v.metaEventId, action: "retry-meta" }),
        FAKE_CTX,
      )
      expect(res.status).toBe(200)
      expect((await listManualSales())[0].metaStatus).toBe("ok")

      const evento = purchaseEnviado(fm)
      expect(evento.user_data.fbc).toBe("fb.1.1700000000.ClicDelAnuncio")
      expect(evento.user_data.fbp).toBe("fb.1.1700000000.987654321")
      // La IP y el user-agent tienen que ser los del COMPRADOR, no los del
      // admin que aprieta el botón desde el panel (FAKE_CTX).
      expect(evento.user_data.client_ip_address).toBe("190.10.20.30")
      expect(evento.user_data.client_user_agent).toContain("Comprador")
      // Geo y external_id hasheados: alcanza con verificar que viajan.
      expect(evento.user_data.ct).toBeDefined()
      expect(evento.user_data.st).toBeDefined()
      expect(evento.user_data.external_id).toBeDefined()
      expect(evento.custom_data.custom_properties).toEqual({ campania: "REELS AGOSTO" })
    })

    it("sin rastro indexado el reintento sale igual, sólo que sin las cookies", async () => {
      const fm = installFetchMock()
      let metaCaida = true
      fm.on("graph.facebook.com", () =>
        metaCaida ? jsonResponse({ error: "boom" }, 500) : jsonResponse({}),
      )

      // Nadie pasó por el sitio: no hay nada en el índice por teléfono.
      await cargarVenta()
      const [v] = await listManualSales()
      expect(v.metaStatus).toBe("error")

      metaCaida = false
      const res = await updateHandler(
        updateReq({ token: TOKEN, eventId: v.metaEventId, action: "retry-meta" }),
        FAKE_CTX,
      )
      expect(res.status).toBe(200)

      const evento = purchaseEnviado(fm)
      expect(evento.user_data.fbc).toBeUndefined()
      // El país fijo "ar" sigue siendo el respaldo cuando no hay geo real.
      expect(evento.user_data.country).toBeDefined()
      expect(evento.user_data.ph).toBeDefined()
    })
  })
})
