import { beforeEach, describe, expect, it } from "vitest"
import { installFetchMock, jsonResponse } from "./helpers/fetchMock"

const { fetchAdSpend } = await import("../lib/metaAdSpend")

describe("fetchAdSpend", () => {
  beforeEach(() => {
    process.env.META_MARKETING_ACCESS_TOKEN = "mkt-token"
  })

  it("suma el gasto total y lo desglosa por campaña", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () =>
      jsonResponse({
        data: [
          { spend: "1500.50", campaign_name: "Reel PC lenta", account_currency: "ARS" },
          { spend: "800", campaign_name: "Historia FPS", account_currency: "ARS" },
        ],
      }),
    )

    const s = await fetchAdSpend("2026-08-01", "2026-08-27")
    expect(s.total).toBe(2300.5)
    expect(s.currency).toBe("ARS")
    expect(s.porCampana["Reel PC lenta"]).toBe(1500.5)
    expect(s.porCampana["Historia FPS"]).toBe(800)
  })

  it("pide level=campaign + time_range y sigue la paginación", async () => {
    const fm = installFetchMock()
    let call = 0
    fm.on("graph.facebook.com", () => {
      call++
      if (call === 1) {
        return jsonResponse({
          data: [{ spend: "100", campaign_name: "A", account_currency: "ARS" }],
          paging: { next: "https://graph.facebook.com/v21.0/act_x/insights?after=CURSOR" },
        })
      }
      return jsonResponse({ data: [{ spend: "50", campaign_name: "B" }] })
    })

    const s = await fetchAdSpend("2026-08-01", "2026-08-27")
    const firstUrl = fm.callsTo("graph.facebook.com")[0].url
    expect(firstUrl).toContain("level=campaign")
    expect(firstUrl).toContain("time_range=")
    expect(firstUrl).toContain("limit=500")
    expect(fm.callsTo("graph.facebook.com")).toHaveLength(2) // siguió paging.next
    expect(s.total).toBe(150)
    expect(s.porCampana["B"]).toBe(50)
  })

  it("data vacía → total 0, sin campañas", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({ data: [] }))
    const s = await fetchAdSpend("2026-08-01", "2026-08-27")
    expect(s.total).toBe(0)
    expect(Object.keys(s.porCampana)).toHaveLength(0)
  })

  it("respuesta no-JSON no tumba: tira un error con el status", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => new Response("<html>502 Bad Gateway</html>", { status: 502 }))
    await expect(fetchAdSpend("2026-08-01", "2026-08-27")).rejects.toThrow("502")
  })

  it("tira error si Meta responde con error", async () => {
    const fm = installFetchMock()
    fm.on("graph.facebook.com", () => jsonResponse({ error: { message: "token vencido" } }, 400))
    await expect(fetchAdSpend("2026-08-01", "2026-08-27")).rejects.toThrow("token vencido")
  })

  it("tira error claro si falta el token", async () => {
    delete process.env.META_MARKETING_ACCESS_TOKEN
    await expect(fetchAdSpend("2026-08-01", "2026-08-27")).rejects.toThrow("META_MARKETING_ACCESS_TOKEN")
  })
})
