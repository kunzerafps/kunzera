import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeGetStore, resetBlobsMock, setStoreWritesFail } from "./helpers/blobsMock"
import { installFetchMock, jsonResponse } from "./helpers/fetchMock"

vi.mock("@netlify/blobs", () => ({ getStore: (name: string) => fakeGetStore(name) }))

const { createSessionToken } = await import("../lib/adminSession")
const { default: ventaManualHandler } = await import("../capi-venta-manual.mts")
const { listManualSales } = await import("../lib/manualSalesStore")

const FAKE_CTX = { ip: "200.1.2.3" } as any

// Relativo a "ahora" en vez de una fecha fija: capi-venta-manual.mts rechaza
// cualquier fecha de más de MAX_EVENT_AGE_DAYS (7) atrás, así que una fecha
// quemada como "2026-08-01" empieza a fallar sola apenas pasan esos 7 días.
function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// Body base con un email válido — el email es obligatorio desde que se
// agregó para reforzar el match con Meta.
function base(extra: Record<string, unknown> = {}) {
  return {
    token: TOKEN,
    nombre: "Cliente",
    whatsapp: "1155554444",
    email: "cliente@mail.com",
    monto: 50000,
    ...extra,
  }
}

let TOKEN: string

function req(body: Record<string, unknown>) {
  return new Request("https://kunzera.com/api/capi-venta-manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("capi-venta-manual (ventas offline por WhatsApp)", () => {
  beforeEach(() => {
    resetBlobsMock()
    process.env.ADMIN_SESSION_SECRET = "test-admin-secret"
    process.env.META_CAPI_ACCESS_TOKEN = "test-meta-token"
    delete process.env.MP_DISCORD_WEBHOOK_URL
    TOKEN = createSessionToken()!
  })

  it("dos compras distintas del mismo cliente y mismo monto, en días distintos, SÍ se registran por separado", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    const b = { ...base(), nombre: "Cliente Recurrente" }
    await ventaManualHandler(req({ ...b, fecha: daysAgoISO(2) }), FAKE_CTX)
    await ventaManualHandler(req({ ...b, fecha: daysAgoISO(1) }), FAKE_CTX)

    expect(fm.callsTo("graph.facebook.com")).toHaveLength(2)
    const [first, second] = fm.callsTo("graph.facebook.com")
    const firstId = JSON.parse(String(first.init?.body)).data[0].event_id
    const secondId = JSON.parse(String(second.init?.body)).data[0].event_id
    expect(firstId).not.toBe(secondId)

    const ventas = await listManualSales()
    expect(ventas).toHaveLength(2)
  })

  it("la misma carga (mismo teléfono+monto+día) mandada dos veces por error no duplica la venta", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    const body = base({ fecha: daysAgoISO(1) })
    const r1 = await ventaManualHandler(req(body), FAKE_CTX)
    const r2 = await ventaManualHandler(req(body), FAKE_CTX) // carga duplicada por error

    expect(fm.callsTo("graph.facebook.com")).toHaveLength(1)
    const d1 = await r1.json()
    const d2 = await r2.json()
    expect(d2.duplicate).toBe(true)
    expect(d2.id).toBe(d1.id)

    const ventas = await listManualSales()
    expect(ventas).toHaveLength(1)
  })

  it("rechaza una fecha futura", async () => {
    const mañana = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const res = await ventaManualHandler(req(base({ fecha: mañana })), FAKE_CTX)
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.error).toBe("fecha_futura")
  })

  it("rechaza una fecha de más de 7 días atrás", async () => {
    const hace10dias = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const res = await ventaManualHandler(req(base({ fecha: hace10dias })), FAKE_CTX)
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.error).toBe("fecha_muy_vieja")
  })

  it("rechaza un WhatsApp inválido (muy corto / solo espacios) antes de mandar nada a Meta", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    const res = await ventaManualHandler(req(base({ whatsapp: "   " })), FAKE_CTX)
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(fm.callsTo("graph.facebook.com")).toHaveLength(0)
  })

  it("rechaza si falta el email, antes de mandar nada a Meta", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    const { email: _omit, ...sinEmail } = base()
    const res = await ventaManualHandler(req(sinEmail), FAKE_CTX)
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.error).toBe("email_invalido")
    expect(fm.callsTo("graph.facebook.com")).toHaveLength(0)
  })

  it("rechaza un email con formato inválido", async () => {
    const res = await ventaManualHandler(req(base({ email: "no-es-un-email" })), FAKE_CTX)
    const data = await res.json()
    expect(data.ok).toBe(false)
    expect(data.error).toBe("email_invalido")
  })

  it("manda el email hasheado (em) y el país (ar) a Meta", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await ventaManualHandler(req(base({ email: "  Test.Cliente@GMAIL.com " })), FAKE_CTX)

    const sent = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    const userData = sent.data[0].user_data
    // hash SHA-256 hex del email ya normalizado (minúsculas + trim)
    const expected = await sha256HexNode("test.cliente@gmail.com")
    expect(userData.em[0]).toBe(expected)
    expect(userData.em[0]).not.toContain("gmail")
    expect(userData.country[0]).toBe(await sha256HexNode("ar"))
  })

  it("guarda la venta en el registro con un ID legible KZM-...", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    const res = await ventaManualHandler(req(base({ fecha: daysAgoISO(1), campania: "Reel PC lenta" })), FAKE_CTX)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.metaStatus).toBe("ok")
    expect(data.id).toMatch(/^KZM-\d{6}-[A-HJ-NP-Z2-9]{4}$/)

    const [venta] = await listManualSales()
    expect(venta.id).toBe(data.id)
    expect(venta.email).toBe("cliente@mail.com")
    expect(venta.campania).toBe("Reel PC lenta")
    expect(venta.metaStatus).toBe("ok")
  })

  it("si Meta falla, la venta igual queda registrada como pendiente", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({ error: "meta caido" }, 500))

    const res = await ventaManualHandler(req(base({ fecha: daysAgoISO(1) })), FAKE_CTX)
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.metaStatus).toBe("error")
    expect(data.id).toMatch(/^KZM-/)

    const [venta] = await listManualSales()
    expect(venta.metaStatus).toBe("error")
    expect(venta.metaError).toBeTruthy()
  })

  it("event_time nunca queda en el futuro al cargar una venta de 'hoy' antes del mediodía Argentina (bug real encontrado probando en vivo)", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-05T08:00:00Z"))
    try {
      const fm = installFetchMock()
      fm.on("graph.facebook.com", () => jsonResponse({}))

      await ventaManualHandler(req(base({ fecha: "2026-08-05" })), FAKE_CTX)

      const sentBody = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
      const nowSeconds = Math.floor(Date.now() / 1000)
      expect(sentBody.data[0].event_time).toBeLessThanOrEqual(nowSeconds)
    } finally {
      vi.useRealTimers()
    }
  })

  it("usa business_messaging como action_source (no 'website', no llega por el sitio)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await ventaManualHandler(req(base()), FAKE_CTX)

    const sentBody = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body))
    expect(sentBody.data[0].action_source).toBe("business_messaging")
  })

  it("NO le saca los acentos al email antes de hashear (a diferencia de nombre/apellido)", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))

    await ventaManualHandler(req(base({ email: "José.Núñez@Gmail.com" })), FAKE_CTX)

    const userData = JSON.parse(String(fm.callsTo("graph.facebook.com")[0].init?.body)).data[0].user_data
    expect(userData.em[0]).toBe(await sha256HexNode("josé.núñez@gmail.com"))
  })

  it("si el registro no se puede guardar, devuelve 500 no_se_guardo y no persiste nada", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    setStoreWritesFail("ventas-manuales")

    const res = await ventaManualHandler(req(base({ fecha: daysAgoISO(1) })), FAKE_CTX)
    const data = await res.json()
    expect(res.status).toBe(500)
    expect(data.ok).toBe(false)
    expect(data.error).toBe("no_se_guardo")
    expect(data.metaStatus).toBe("ok") // Meta sí recibió el evento

    setStoreWritesFail("ventas-manuales", false)
    expect(await listManualSales()).toHaveLength(0)
  })

  it("tras un no_se_guardo, recargar la venta la persiste sin re-mandarla a Meta", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({}))
    const body = base({ fecha: daysAgoISO(1) })

    setStoreWritesFail("ventas-manuales")
    await ventaManualHandler(req(body), FAKE_CTX) // 500, Meta ya recibió
    expect(fm.callsTo("graph.facebook.com")).toHaveLength(1)

    setStoreWritesFail("ventas-manuales", false)
    const res = await ventaManualHandler(req(body), FAKE_CTX)
    const data = await res.json()
    expect(data.ok).toBe(true)
    // metaCapi deduplica por su propio marcador: no se vuelve a llamar a Meta.
    expect(fm.callsTo("graph.facebook.com")).toHaveLength(1)
    expect(await listManualSales()).toHaveLength(1)
  })

  it("recargar una venta cuyo primer intento a Meta falló devuelve duplicate sin re-llamar a Meta", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({ error: "meta caido" }, 500))
    const body = base({ fecha: daysAgoISO(1) })

    const r1 = await ventaManualHandler(req(body), FAKE_CTX)
    const d1 = await r1.json()
    expect(d1.metaStatus).toBe("error")
    // metaCapi reintenta un 5xx dentro del mismo llamado (varias calls acá).
    const callsTrasR1 = fm.callsTo("graph.facebook.com").length
    expect(callsTrasR1).toBeGreaterThanOrEqual(1)

    const r2 = await ventaManualHandler(req(body), FAKE_CTX)
    const d2 = await r2.json()
    expect(d2.duplicate).toBe(true)
    expect(d2.metaStatus).toBe("error")
    expect(d2.id).toBe(d1.id)
    // La recarga NO vuelve a pegarle a Meta: se resuelve por el registro local.
    expect(fm.callsTo("graph.facebook.com")).toHaveLength(callsTrasR1)
  })

  it("rechaza una venta fechada 7 días atrás cargada por la tarde (event_time > 168h aunque la fecha 'entre')", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-27T18:00:00Z")) // 15:00 hora Argentina
    try {
      const freshToken = createSessionToken()!
      const fm = installFetchMock()
      fm.on("graph.facebook.com", () => jsonResponse({}))

      const res = await ventaManualHandler(
        req({
          token: freshToken,
          nombre: "Cliente",
          whatsapp: "1155554444",
          email: "cliente@mail.com",
          monto: 50000,
          fecha: "2026-08-20", // exactamente 7 días antes
        }),
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
})

// Cálculo independiente del hash (mismo algoritmo, recalculado a mano) para
// no "probar la función contra sí misma".
async function sha256HexNode(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest("SHA-256", enc)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}
