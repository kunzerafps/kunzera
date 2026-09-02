import { afterEach, describe, expect, it, vi } from "vitest"
import { logMetaResponse } from "../lib/metaResponseLog"
import { jsonResponse } from "./helpers/fetchMock"

describe("logMetaResponse", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("no loguea nada cuando Meta responde limpio (events_received=1, sin messages)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await logMetaResponse(jsonResponse({ events_received: 1, messages: [], fbtrace_id: "abc" }), "test")
    expect(warn).not.toHaveBeenCalled()
  })

  it("advierte cuando el cuerpo trae messages (advertencias no fatales)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await logMetaResponse(
      jsonResponse({
        events_received: 1,
        messages: [{ message: "param 'foo' ignored" }],
        fbtrace_id: "trace-1",
      }),
      "metaCapi:Purchase",
    )
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0].join(" "))).toContain("advertencias")
    expect(String(warn.mock.calls[0].join(" "))).toContain("trace-1")
  })

  it("advierte cuando events_received es 0 (evento aceptado pero no contabilizado)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    await logMetaResponse(jsonResponse({ events_received: 0, messages: [] }), "test")
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0].join(" "))).toContain("events_received=0")
  })

  it("no tira si el cuerpo no es JSON", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const res = new Response("<html>502 Bad Gateway</html>", { status: 200 })
    // Conservador: si el cuerpo no se puede leer, NO se afirma que Meta
    // descartó el evento (eso cortaría envíos que hoy funcionan).
    await expect(logMetaResponse(res, "test")).resolves.toEqual({ eventsReceivedZero: false })
    expect(warn).not.toHaveBeenCalled()
  })

  it("no consume el body original (usa clone)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const res = jsonResponse({ events_received: 1, messages: [] })
    await logMetaResponse(res, "test")
    // el caller todavía puede leer el body después
    await expect(res.text()).resolves.toContain("events_received")
  })
})
