import type { Context } from "@netlify/functions"
import { getStore } from "@netlify/blobs"
import { verifySessionToken } from "./lib/adminSession"

const STORE_NAME = "site-config"
const KEY = "site-config"
const MAX_TEMPLATE_LEN = 1000

type PackPrices = { ars: number; usd: number }

type BlockedWindow = {
  id: string
  start: string
  end: string
  label?: string
}

const DEFAULTS = {
  clientTemplate:
    "¡Hola {nombre}! Soy Kun, de Kunzera. Gracias por reservar tu turno del pack {pack} para el {turno}. Te escribo para coordinar los detalles y comenzar la optimización de tu PC. ¿Te viene bien arrancar en ese horario?",
  prices: {
    platino: { ars: 50000, usd: 45 } as PackPrices,
    diamante: { ars: 70000, usd: 65 } as PackPrices,
  },
  adminPasswordHash: "",
  blockedWindows: [] as BlockedWindow[],
}

const HEX_64_RE = /^[a-f0-9]{64}$/i

function sanitizeHash(o: unknown): string {
  if (typeof o !== "string") return ""
  const trimmed = o.trim().toLowerCase()
  if (!trimmed) return ""
  return HEX_64_RE.test(trimmed) ? trimmed : ""
}

type Config = typeof DEFAULTS

function clampPrice(n: unknown, fallback: number): number {
  const v = typeof n === "number" ? n : Number(n)
  if (!Number.isFinite(v) || v < 0) return fallback
  return Math.round(v * 100) / 100
}

function sanitizePack(o: unknown, fallback: PackPrices): PackPrices {
  const obj = (o ?? {}) as Partial<Record<keyof PackPrices, unknown>>
  return {
    ars: clampPrice(obj.ars, fallback.ars),
    usd: clampPrice(obj.usd, fallback.usd),
  }
}

function sanitizeIsoDate(s: unknown): string | null {
  if (typeof s !== "string") return null
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function sanitizeBlockedWindow(o: unknown): BlockedWindow | null {
  const obj = (o ?? {}) as Partial<Record<keyof BlockedWindow, unknown>>
  const start = sanitizeIsoDate(obj.start)
  const end = sanitizeIsoDate(obj.end)
  if (!start || !end) return null
  if (new Date(end).getTime() <= new Date(start).getTime()) return null
  const id =
    typeof obj.id === "string" && obj.id.trim()
      ? obj.id.trim().slice(0, 64)
      : `${start}_${end}`
  const labelRaw = typeof obj.label === "string" ? obj.label.trim() : ""
  const label = labelRaw ? labelRaw.slice(0, 80) : undefined
  return label ? { id, start, end, label } : { id, start, end }
}

function sanitizeBlockedWindows(o: unknown): BlockedWindow[] {
  if (!Array.isArray(o)) return []
  return o
    .map(sanitizeBlockedWindow)
    .filter((w): w is BlockedWindow => w !== null)
    .slice(0, 50)
}

function sanitize(input: unknown): Config {
  const o = (input ?? {}) as Partial<Record<keyof Config, unknown>>
  const clientTemplate =
    typeof o.clientTemplate === "string" && o.clientTemplate.trim()
      ? o.clientTemplate.trim().slice(0, MAX_TEMPLATE_LEN)
      : DEFAULTS.clientTemplate
  const pricesIn = (o.prices ?? {}) as Partial<
    Record<keyof Config["prices"], unknown>
  >
  const prices = {
    platino: sanitizePack(pricesIn.platino, DEFAULTS.prices.platino),
    diamante: sanitizePack(pricesIn.diamante, DEFAULTS.prices.diamante),
  }
  const adminPasswordHash = sanitizeHash(o.adminPasswordHash)
  const blockedWindows = sanitizeBlockedWindows(o.blockedWindows)
  return { clientTemplate, prices, adminPasswordHash, blockedWindows }
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Cache-Control": "no-store",
  }
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  const headers = corsHeaders()

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers })
  }

  const store = getStore(STORE_NAME)

  if (req.method === "GET") {
    const data = await store.get(KEY, { type: "json" })
    return Response.json({ ok: true, config: sanitize(data) }, { headers })
  }

  if (req.method === "POST") {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return Response.json(
        { ok: false, error: "invalid_json" },
        { status: 400, headers },
      )
    }

    const sent = (body as { token?: unknown })?.token
    if (!verifySessionToken(sent)) {
      return Response.json(
        { ok: false, error: "unauthorized" },
        { status: 401, headers },
      )
    }

    const config = sanitize((body as { config?: unknown })?.config)
    await store.setJSON(KEY, config)
    return Response.json({ ok: true, config }, { headers })
  }

  return Response.json(
    { ok: false, error: "method_not_allowed" },
    { status: 405, headers },
  )
}

export const config = {
  path: "/api/wa-messages",
}
