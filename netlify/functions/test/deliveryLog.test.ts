import { beforeEach, describe, expect, it, vi } from "vitest"
import { fakeGetStore, resetBlobsMock } from "./helpers/blobsMock"

vi.mock("@netlify/blobs", () => ({ getStore: (name: string) => fakeGetStore(name) }))

const { recordDelivery, listRecentDeliveries } = await import("../lib/deliveryLog")

describe("listRecentDeliveries", () => {
  beforeEach(() => resetBlobsMock())

  it("devuelve las N más recientes por lastAttemptAt aunque las claves NO estén en orden de fecha", async () => {
    // Claves (eventId) elegidas a propósito para que el orden alfabético NO
    // coincida con el orden temporal: la más nueva ("aaa...") sería la
    // primera por key, la más vieja ("zzz...") la última — al revés de lo
    // que querés. El bug viejo cortaba por key ANTES de mirar la fecha.
    const now = Date.now()
    vi.useFakeTimers()

    vi.setSystemTime(now - 3 * 60_000)
    await recordDelivery({ eventId: "zzz-vieja", source: "venta_manual", ok: true, dedupedLocally: false })

    vi.setSystemTime(now - 2 * 60_000)
    await recordDelivery({ eventId: "mmm-media", source: "venta_manual", ok: true, dedupedLocally: false })

    vi.setSystemTime(now - 1 * 60_000)
    await recordDelivery({ eventId: "aaa-nueva", source: "venta_manual", ok: true, dedupedLocally: false })

    vi.useRealTimers()

    const top2 = await listRecentDeliveries(2)
    expect(top2.map((e) => e.eventId)).toEqual(["aaa-nueva", "mmm-media"])

    const all = await listRecentDeliveries(50)
    expect(all.map((e) => e.eventId)).toEqual(["aaa-nueva", "mmm-media", "zzz-vieja"])
  })
})
