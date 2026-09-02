import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeGetStore, resetBlobsMock } from "./helpers/blobsMock"
import { installFetchMock, jsonResponse } from "./helpers/fetchMock"

vi.mock("@netlify/blobs", () => ({ getStore: (name: string) => fakeGetStore(name) }))

const { default: funnelHandler } = await import("../capi-funnel.mts")

function req(body: Record<string, unknown>, userAgent = "Mozilla/5.0 Visitante") {
  return new Request("https://kunzera.com/api/capi-funnel", {
    method: "POST",
    headers: { "Content-Type": "application/json", "user-agent": userAgent },
    body: JSON.stringify(body),
  })
}

describe("capi-funnel", () => {
  beforeEach(() => {
    resetBlobsMock()
    process.env.META_CAPI_ACCESS_TOKEN = "test-token"
  })

  it("manda a Meta el evento con la IP real del request (ctx.ip) y el user-agent", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const ctx = { ip: "201.201.201.201" } as any

    await funnelHandler(req({ eventId: "cf-lead-1", event: "Lead", whatsapp: "1123456789" }), ctx)

    const userData = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0].user_data
    expect(userData.client_ip_address).toBe("201.201.201.201")
    expect(userData.client_user_agent).toBe("Mozilla/5.0 Visitante")
    expect(userData.ph[0]).toHaveLength(64)
  })

  it("pasa la geo de ctx.geo a Meta (nombre de provincia, no código)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const ctx = {
      ip: "200.1.2.3",
      geo: {
        city: "Rosario",
        subdivision: { code: "S", name: "Santa Fe" },
        postalCode: "2000",
        country: { code: "AR" },
      },
    } as any

    await funnelHandler(req({ eventId: "cf-geo-1", event: "Lead" }), ctx)

    const userData = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0].user_data
    // van hasheados (64 hex) — acá sólo verificamos que se mandan los 4 campos
    expect(userData.ct[0]).toHaveLength(64)
    expect(userData.st[0]).toHaveLength(64)
    expect(userData.zp[0]).toHaveLength(64)
    expect(userData.country[0]).toHaveLength(64)
  })

  it("sin ctx.geo no rompe ni manda ct/st/zp/country", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const ctx = { ip: "1.2.3.4" } as any

    await funnelHandler(req({ eventId: "cf-nogeo", event: "Lead" }), ctx)

    const userData = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0].user_data
    expect(userData.ct).toBeUndefined()
    expect(userData.country).toBeUndefined()
  })

  it("acepta InitiateCheckout", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const ctx = { ip: "1.2.3.4" } as any

    await funnelHandler(
      req({ eventId: "cf-ic-1", event: "InitiateCheckout", contentIds: ["platino"] }),
      ctx,
    )

    const body = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    expect(body.data[0].event_name).toBe("InitiateCheckout")
    // El monto lo pone el SERVIDOR a partir del pack, no el navegador.
    expect(body.data[0].custom_data.value).toBe(50000)
    expect(body.data[0].custom_data.currency).toBe("ARS")
  })

  it("acepta ViewContent y AddToCart (nuevos eventos server-side)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const ctx = { ip: "1.2.3.4" } as any

    await funnelHandler(
      req({
        eventId: "cf-vc-1",
        event: "ViewContent",
        contentIds: ["platino", "diamante"],
        contentType: "product_group",
        contentName: "pricing_section",
      }),
      ctx,
    )
    await funnelHandler(
      req({ eventId: "cf-atc-1", event: "AddToCart", value: 70000, contentIds: ["diamante"] }),
      ctx,
    )

    const bodies = fm.callsTo("graph.facebook.com").map((c) => JSON.parse(String(c.init?.body)))
    expect(bodies[0].data[0].event_name).toBe("ViewContent")
    // contentIds llega tal cual, sin pasar por la conversión de slug
    expect(bodies[0].data[0].custom_data.content_ids).toEqual(["platino", "diamante"])
    expect(bodies[0].data[0].custom_data.content_type).toBe("product_group")
    // ViewContent de la sección no lleva value (no es una compra con monto)
    expect(bodies[0].data[0].custom_data.value).toBeUndefined()
    expect(bodies[1].data[0].event_name).toBe("AddToCart")
    expect(bodies[1].data[0].custom_data.value).toBe(70000)
    expect(bodies[1].data[0].custom_data.content_ids).toEqual(["diamante"])
  })

  it("acepta turno_seleccionado (con el teléfono ya cargado) pero NO Schedule por esta vía pública", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const ctx = { ip: "1.2.3.4" } as any

    await funnelHandler(
      req({
        eventId: "cf-sel-1",
        event: "turno_seleccionado",
        value: 50000,
        // El monto ya no se toma del body: se resuelve en el servidor a
        // partir del pack (ver lib/packPrices.ts), así que el evento tiene
        // que traer content_ids para llevar valor.
        contentIds: ["platino"],
        whatsapp: "1155554444",
      }),
      ctx,
    )
    // Schedule salió de la lista pública (FUNNEL_EVENTS): es objetivo de
    // campaña y ahora es 100% server-side (mp-webhook / capi-confirmar-pago).
    // Un cliente manipulado ya no puede fabricar una conversión "reservó".
    await funnelHandler(req({ eventId: "cf-sch-1", event: "Schedule", value: 70000, whatsapp: "1155554444" }), ctx)

    const bodies = fm.callsTo("graph.facebook.com").map((c) => JSON.parse(String(c.init?.body)))
    expect(bodies).toHaveLength(1)
    expect(bodies[0].data[0].event_name).toBe("turno_seleccionado")
    expect(bodies[0].data[0].custom_data.value).toBe(50000)
    expect(bodies[0].data[0].action_source).toBe("website")
    // turno_seleccionado ahora llega con el teléfono ya cargado (askWhatsapp
    // pasó antes en el flujo) — antes iba anónimo.
    expect(bodies[0].data[0].user_data.ph[0]).toHaveLength(64)
  })

  it("un cliente que POSTea event: 'Schedule' al endpoint público no genera ningún evento", async () => {
    const fm = installFetchMock()
    const ctx = { ip: "1.2.3.4" } as any

    const res = await funnelHandler(req({ eventId: "cf-fake-sched", event: "Schedule", value: 999999 }), ctx)

    expect(res.status).toBe(200)
    expect(fm.calls.length).toBe(0)
  })

  it("turno_seleccionado también respeta META_CAPI_TEST_EVENT_CODE", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    process.env.META_CAPI_TEST_EVENT_CODE = "TESTQ"
    const ctx = { ip: "1.2.3.4" } as any
    try {
      await funnelHandler(req({ eventId: "cf-tsel-tc", event: "turno_seleccionado" }), ctx)
      const body = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
      expect(body.test_event_code).toBe("TESTQ")
    } finally {
      delete process.env.META_CAPI_TEST_EVENT_CODE
    }
  })

  it("content_ids inventados NO llegan a Meta: sólo pasan los slugs de pack reconocidos", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const ctx = { ip: "1.2.3.4" } as any
    const many = Array.from({ length: 50 }, (_, i) => `x${i}`)

    await funnelHandler(req({ eventId: "cf-many", event: "AddToCart", contentIds: many }), ctx)

    const body = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    // Endpoint público sin contraseña: content_ids es lo que agrupa públicos y
    // catálogo en Meta, así que basura de afuera se descarta entera.
    expect(body.data[0].custom_data?.content_ids).toBeUndefined()
  })

  it("de una mezcla de slugs reales y basura sobreviven sólo los packs", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const ctx = { ip: "1.2.3.4" } as any

    await funnelHandler(
      req({
        eventId: "cf-mix-1",
        event: "AddToCart",
        contentIds: ["diamante", "pack-trucho"],
        contentName: "Pack Diamante",
      }),
      ctx,
    )

    const cd = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0].custom_data
    expect(cd.content_ids).toEqual(["diamante"])
  })

  it("si mandó content_ids y ninguno era un pack, tampoco se le cree el content_name", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const ctx = { ip: "1.2.3.4" } as any

    await funnelHandler(
      req({
        eventId: "cf-mix-2",
        event: "AddToCart",
        contentIds: ["pack-trucho"],
        contentName: "basura-del-atacante",
      }),
      ctx,
    )

    // metaCapiFunnel tiene una rama de compat que arma content_ids a partir
    // del content_name cuando no hay ids: sin este corte, la basura entraba
    // igual por esa ventana.
    const cd = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0].custom_data
    expect(cd?.content_ids).toBeUndefined()
    expect(cd?.content_name).toBeUndefined()
  })

  it("acepta el evento Contact (tocó WhatsApp) y le adjunta id de navegador + IP para la atribución", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const ctx = { ip: "190.190.190.190" } as any

    const res = await funnelHandler(
      req({ eventId: "cf-contact-1", event: "Contact", externalId: "vid-xyz", fbp: "fb.1.1.2" }),
      ctx,
    )

    expect(res.status).toBe(200)
    const data = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0]
    expect(data.event_name).toBe("Contact")
    expect(data.user_data.client_ip_address).toBe("190.190.190.190")
    expect(data.user_data.external_id[0]).toHaveLength(64)
    expect(data.user_data.fbp).toBe("fb.1.1.2")
  })

  it("un event_name no permitido (ej. Purchase) no manda nada a Meta", async () => {
    const fm = installFetchMock()
    const ctx = { ip: "1.2.3.4" } as any

    const res = await funnelHandler(req({ eventId: "cf-bad-evt", event: "Purchase", value: 999999 }), ctx)

    expect(res.status).toBe(200)
    expect(fm.calls.length).toBe(0)
  })

  it("un eventId inválido no manda nada a Meta", async () => {
    const fm = installFetchMock()
    const ctx = { ip: "1.2.3.4" } as any

    const res = await funnelHandler(req({ eventId: "; drop table--", event: "Lead" }), ctx)

    expect(res.status).toBe(200)
    expect(fm.calls.length).toBe(0)
  })

  it("sin eventId o sin event no manda nada", async () => {
    const fm = installFetchMock()
    const ctx = { ip: "1.2.3.4" } as any

    await funnelHandler(req({ event: "Lead" }), ctx)
    await funnelHandler(req({ eventId: "cf-missing" }), ctx)

    expect(fm.calls.length).toBe(0)
  })

  it("respeta el límite de requests por IP", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const ctx = { ip: "9.9.9.9" } as any

    for (let i = 0; i < 150; i++) {
      await funnelHandler(req({ eventId: `cf-rl-${i}`, event: "Lead" }), ctx)
    }
    const callsAfterLimit = fm.calls.length
    await funnelHandler(req({ eventId: "cf-rl-extra", event: "Lead" }), ctx)

    expect(fm.calls.length).toBe(callsAfterLimit)
  })

  it("un método distinto de POST no hace nada", async () => {
    const fm = installFetchMock()
    const ctx = { ip: "1.2.3.4" } as any

    const res = await funnelHandler(
      new Request("https://kunzera.com/api/capi-funnel", { method: "GET" }),
      ctx,
    )

    expect(res.status).toBe(200)
    expect(fm.calls.length).toBe(0)
  })

  // Este endpoint es público y sin contraseña por diseño (lo llama cualquier
  // visitante anónimo para mandar la copia server-side de los eventos, la que
  // los bloqueadores no pueden tapar). Antes aceptaba el `value` del body sin
  // verificarlo: cualquiera podía mandar cientos de "dejó los datos" por
  // $999.999.999 y ensuciarle a Meta la optimización por valor.
  describe("el monto lo pone el servidor, nunca el cliente", () => {
    const ctx = { ip: "7.7.7.7" } as any

    it("ignora un monto inventado y manda el precio real del pack", async () => {
      const fm = installFetchMock()
      fm.on("graph.facebook.com", () => jsonResponse({}))

      await funnelHandler(
        req({
          eventId: "cf-hack-1",
          event: "Lead",
          value: 999999999, // ← lo que mandaría un atacante
          currency: "USD",
          contentIds: ["diamante"],
        }),
        ctx,
      )

      const cd = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0].custom_data
      expect(cd.value).toBe(70000) // el precio real, no el inventado
      expect(cd.value).not.toBe(999999999)
      expect(cd.currency).toBe("ARS") // la moneda tampoco se acepta del cliente
    })

    it("sin un pack conocido el evento va SIN monto, en vez de con uno inventado", async () => {
      const fm = installFetchMock()
      fm.on("graph.facebook.com", () => jsonResponse({}))

      await funnelHandler(
        req({ eventId: "cf-hack-2", event: "Lead", value: 999999999, contentIds: ["pack-trucho"] }),
        ctx,
      )

      const cd = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0].custom_data
      expect(cd?.value).toBeUndefined()
    })

    it("con los dos packs (la sección de precios) tampoco inventa un monto", async () => {
      const fm = installFetchMock()
      fm.on("graph.facebook.com", () => jsonResponse({}))

      await funnelHandler(
        req({
          eventId: "cf-hack-3",
          event: "ViewContent",
          value: 999999999,
          contentIds: ["platino", "diamante"],
        }),
        ctx,
      )

      const cd = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0].custom_data
      expect(cd?.value).toBeUndefined()
    })

    it("usa el precio que Eze tiene puesto en el panel, no el hardcodeado", async () => {
      const fm = installFetchMock()
      fm.on("graph.facebook.com", () => jsonResponse({}))
      // Igual que cuando cambia un precio desde Configuración.
      await fakeGetStore("site-config").set("site-config", {
        prices: { platino: { ars: 55000, usd: 45 }, diamante: { ars: 80000, usd: 65 } },
      })

      await funnelHandler(
        req({ eventId: "cf-precio-1", event: "AddToCart", contentIds: ["diamante"] }),
        ctx,
      )

      const cd = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0].custom_data
      expect(cd.value).toBe(80000)
    })
  })
})
