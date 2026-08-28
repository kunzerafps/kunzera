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
