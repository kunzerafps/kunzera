import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeGetStore, resetBlobsMock } from "./helpers/blobsMock"
import { installFetchMock, jsonResponse } from "./helpers/fetchMock"

vi.mock("@netlify/blobs", () => ({ getStore: (name: string) => fakeGetStore(name) }))

const { createSessionToken } = await import("../lib/adminSession")
const { default: funnelHandler } = await import("../capi-funnel.mts")
const { default: ventaManualHandler } = await import("../capi-venta-manual.mts")
const { normalizePhoneForHash, sha256Hex } = await import("../lib/metaUserData")
const { getPhoneAttribution } = await import("../lib/attribution")

// El "Contact"/"Lead" lo dispara el navegador del COMPRADOR (su IP), la venta
// manual la carga el ADMIN desde el panel (otra IP). El puente tiene que
// devolverle a Meta la IP del comprador, nunca la del admin.
const CTX_COMPRADOR = {
  ip: "190.10.20.30",
  geo: {
    city: "Rosario",
    subdivision: { name: "Santa Fe" },
    postalCode: "2000",
    country: { code: "AR" },
  },
} as any
const CTX_ADMIN = { ip: "200.1.2.3" } as any

const TELEFONO = "3411234567"

function leadReq(body: Record<string, unknown>) {
  return new Request("https://kunzera.com/api/capi-funnel", {
    method: "POST",
    headers: { "Content-Type": "application/json", "user-agent": "Mozilla/5.0 (iPhone) Comprador" },
    body: JSON.stringify(body),
  })
}

function ventaReq(body: Record<string, unknown>) {
  return new Request("https://kunzera.com/api/capi-venta-manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

// Fecha de AYER, no de hoy: toISOString da la fecha en UTC y capi-venta-manual
// compara contra "hoy en Argentina" (UTC-3), asi que despues de las 21hs de
// Argentina el "hoy" en UTC ya es manana y la funcion lo rechaza como futuro.
function ayerISO(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function metaEvent(fm: ReturnType<typeof installFetchMock>, name: string) {
  const call = fm
    .callsTo("graph.facebook.com")
    .find((c) => JSON.parse(String(c.init?.body)).data[0].event_name === name)
  return call ? JSON.parse(String(call.init?.body)).data[0] : undefined
}

let TOKEN: string

beforeEach(() => {
  resetBlobsMock()
  process.env.ADMIN_SESSION_SECRET = "test-admin-secret"
  process.env.META_CAPI_ACCESS_TOKEN = "test-meta-token"
  delete process.env.MP_DISCORD_WEBHOOK_URL
  TOKEN = createSessionToken()!
})

// El agujero que cierra esto: el evento "Contact"/"Lead" que dispara la
// persona al pasar por el sitio SÍ lleva la cookie del clic del anuncio
// (fbc), fbp, IP e id de visitante — pero era fire-and-forget, no quedaba
// guardado. Cuando esa misma venta se cerraba por WhatsApp y se cargaba a
// mano, la Compra le llegaba a Meta con teléfono + mail + nombre + país y
// nada más. Entre los dos eventos el único campo en común era el país.
describe("puente teléfono → rastro del anuncio (ventas cerradas por WhatsApp)", () => {
  it("guarda el rastro cuando la persona deja su teléfono en el sitio", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await funnelHandler(
      leadReq({
        eventId: "evento-lead-1",
        event: "Lead",
        whatsapp: TELEFONO,
        nombre: "Juan Perez",
        fbc: "fb.1.1700000000.AbCdEfG",
        fbp: "fb.1.1700000000.987654321",
        externalId: "visitante-abc",
      }),
      CTX_COMPRADOR,
    )

    const guardado = await getPhoneAttribution(await sha256Hex(normalizePhoneForHash(TELEFONO)))
    expect(guardado?.fbc).toBe("fb.1.1700000000.AbCdEfG")
    expect(guardado?.visitorId).toBe("visitante-abc")
    expect(guardado?.ip).toBe("190.10.20.30")
  })

  it("la clave del índice es un hash, no el teléfono en claro", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await funnelHandler(
      leadReq({ eventId: "evento-lead-2", event: "Lead", whatsapp: TELEFONO, fbc: "fb.1.1.X" }),
      CTX_COMPRADOR,
    )

    const { blobs } = await fakeGetStore("attribution-by-phone").list()
    expect(blobs).toHaveLength(1)
    expect(blobs[0].key).toMatch(/^[a-f0-9]{64}$/)
    expect(blobs[0].key).not.toContain(TELEFONO)
  })

  it("la venta cargada a mano recupera el rastro y se lo manda a Meta", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    // 1) La persona pasó por el sitio y dejó su WhatsApp.
    await funnelHandler(
      leadReq({
        eventId: "evento-lead-3",
        event: "Lead",
        whatsapp: TELEFONO,
        fbc: "fb.1.1700000000.ClicDelAnuncio",
        fbp: "fb.1.1700000000.111",
        externalId: "visitante-xyz",
      }),
      CTX_COMPRADOR,
    )
    fm.reset()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    // 2) Terminó cerrando por WhatsApp y Eze la carga a mano.
    const res = await ventaManualHandler(
      ventaReq({
        token: TOKEN,
        nombre: "Juan Perez",
        whatsapp: TELEFONO,
        email: "juan@mail.com",
        monto: 70000,
        pack: "diamante",
        fecha: ayerISO(),
      }),
      CTX_ADMIN,
    )
    expect((await res.json()).ok).toBe(true)

    const purchase = metaEvent(fm, "Purchase")
    // Lo que antes NO llegaba:
    expect(purchase.user_data.fbc).toBe("fb.1.1700000000.ClicDelAnuncio")
    expect(purchase.user_data.fbp).toBe("fb.1.1700000000.111")
    expect(purchase.user_data.external_id).toBeDefined()
    // La IP tiene que ser la del COMPRADOR, no la del admin que carga la venta.
    expect(purchase.user_data.client_ip_address).toBe("190.10.20.30")
    expect(purchase.user_data.client_ip_address).not.toBe(CTX_ADMIN.ip)
    // Y sigue llevando lo de siempre.
    expect(purchase.action_source).toBe("business_messaging")
    expect(purchase.messaging_channel).toBe("whatsapp")
    expect(purchase.custom_data.value).toBe(70000)
  })

  it("el teléfono se matchea aunque se escriba distinto en el sitio y en el panel", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    // En el sitio lo dejó "pelado"…
    await funnelHandler(
      leadReq({ eventId: "evento-lead-4", event: "Lead", whatsapp: "3411234567", fbc: "fb.1.1.Z" }),
      CTX_COMPRADOR,
    )
    fm.reset()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    // …y Eze lo carga a mano como lo tiene en la agenda.
    await ventaManualHandler(
      ventaReq({
        token: TOKEN,
        nombre: "Juan",
        whatsapp: "+54 9 341 123-4567",
        email: "j@mail.com",
        monto: 50000,
        fecha: ayerISO(),
      }),
      CTX_ADMIN,
    )

    expect(metaEvent(fm, "Purchase").user_data.fbc).toBe("fb.1.1.Z")
  })

  it("sin rastro indexado la venta se manda igual, como antes (no rompe nada)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    const res = await ventaManualHandler(
      ventaReq({
        token: TOKEN,
        nombre: "Cliente Sin Rastro",
        whatsapp: "1155554444",
        email: "sin@rastro.com",
        monto: 50000,
        fecha: ayerISO(),
      }),
      CTX_ADMIN,
    )

    expect((await res.json()).ok).toBe(true)
    const purchase = metaEvent(fm, "Purchase")
    expect(purchase.user_data.fbc).toBeUndefined()
    expect(purchase.user_data.ph).toBeDefined() // el match por teléfono sigue
    expect(purchase.user_data.country).toBeDefined() // "ar" por defecto
  })

  it("una visita orgánica posterior NO borra la cookie del clic del anuncio ya guardada", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const phoneKey = await sha256Hex(normalizePhoneForHash(TELEFONO))

    // Primera visita: vino de un anuncio.
    await funnelHandler(
      leadReq({ eventId: "organica-1", event: "Lead", whatsapp: TELEFONO, fbc: "fb.1.1.DelAnuncio" }),
      CTX_COMPRADOR,
    )
    // Segunda visita: entró escribiendo kunzera.com, sin fbc.
    await funnelHandler(
      leadReq({ eventId: "organica-2", event: "Lead", whatsapp: TELEFONO, fbp: "fb.1.2.nuevo" }),
      CTX_COMPRADOR,
    )

    const guardado = await getPhoneAttribution(phoneKey)
    expect(guardado?.fbc).toBe("fb.1.1.DelAnuncio") // se conserva
    expect(guardado?.fbp).toBe("fb.1.2.nuevo") // el resto sí se actualiza
  })

  it("no indexa nada si no hay rastro de anuncio que valga la pena guardar", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await funnelHandler(
      leadReq({ eventId: "sin-nada-1", event: "Lead", whatsapp: TELEFONO, nombre: "Juan" }),
      CTX_COMPRADOR,
    )

    const { blobs } = await fakeGetStore("attribution-by-phone").list()
    expect(blobs).toHaveLength(0)
  })
})
