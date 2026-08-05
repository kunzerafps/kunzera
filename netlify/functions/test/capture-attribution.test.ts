import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeGetStore, resetBlobsMock } from "./helpers/blobsMock"

vi.mock("@netlify/blobs", () => ({ getStore: (name: string) => fakeGetStore(name) }))

const { default: captureHandler } = await import("../capture-attribution.mts")
const { getAttribution } = await import("../lib/attribution")

function req(body: Record<string, unknown>, userAgent = "Mozilla/5.0 ComprdorReal") {
  return new Request("https://kunzera.com/api/capture-attribution", {
    method: "POST",
    headers: { "Content-Type": "application/json", "user-agent": userAgent },
    body: JSON.stringify(body),
  })
}

describe("capture-attribution", () => {
  beforeEach(() => {
    resetBlobsMock()
  })

  it("guarda la IP real del comprador (ctx.ip) y el user-agent del request, no inventados", async () => {
    const ctx = { ip: "201.201.201.201" } as any
    await captureHandler(req({ idempotencyKey: "attr-key-1" }, "Mozilla/5.0 Comprador"), ctx)

    const data = await getAttribution("attr-key-1")
    expect(data?.ip).toBe("201.201.201.201")
    expect(data?.userAgent).toBe("Mozilla/5.0 Comprador")
  })

  it("guarda fbp/fbc tal cual vienen del cliente, sin modificarlos", async () => {
    const ctx = { ip: "201.201.201.201" } as any
    await captureHandler(
      req({ idempotencyKey: "attr-key-2", fbp: "fb.1.111.222", fbc: "fb.1.111.IwAR_real" }),
      ctx,
    )

    const data = await getAttribution("attr-key-2")
    expect(data?.fbp).toBe("fb.1.111.222")
    expect(data?.fbc).toBe("fb.1.111.IwAR_real")
  })

  it("NO inventa fbc cuando el cliente no manda uno (sin fbclid real)", async () => {
    const ctx = { ip: "201.201.201.201" } as any
    await captureHandler(req({ idempotencyKey: "attr-key-3", fbp: "fb.1.111.222" }), ctx)

    const data = await getAttribution("attr-key-3")
    expect(data?.fbc).toBeUndefined()
  })

  it("una idempotencyKey inválida no se guarda", async () => {
    const ctx = { ip: "201.201.201.201" } as any
    await captureHandler(req({ idempotencyKey: "; drop table--" }), ctx)

    const data = await getAttribution("; drop table--")
    expect(data).toBeNull()
  })
})
