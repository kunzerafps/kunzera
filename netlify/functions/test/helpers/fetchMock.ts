import { vi } from "vitest"

export type FetchCall = { url: string; init?: RequestInit }

// Mock de fetch por ruteo de URL (substring) — cada test registra qué
// devolver para cada API externa que toque (graph.facebook.com, Discord,
// api.mercadopago.com, Apps Script). Guarda todas las llamadas para poder
// assertar cuántas veces se llamó a cada una y con qué body.
export function installFetchMock() {
  const calls: FetchCall[] = []
  const handlers: { match: string; respond: () => Response | Promise<Response> }[] = []

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    calls.push({ url, init })
    const handler = handlers.find((h) => url.includes(h.match))
    if (!handler) {
      throw new Error(`[fetchMock] sin handler registrado para: ${url}`)
    }
    return handler.respond()
  })

  vi.stubGlobal("fetch", fetchMock)

  return {
    calls,
    fetchMock,
    on(match: string, respond: () => Response | Promise<Response>) {
      handlers.push({ match, respond })
    },
    callsTo(match: string): FetchCall[] {
      return calls.filter((c) => c.url.includes(match))
    },
    reset() {
      calls.length = 0
      handlers.length = 0
      fetchMock.mockClear()
    },
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}
