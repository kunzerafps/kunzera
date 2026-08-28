import { getAdminToken } from "./storage"
import type { Pack } from "../types/order"
import { DEFAULT_PRICES, setCurrentPrices } from "./prices"

export type PackPrices = { ars: number; usd: number }

export type BlockedWindow = {
  id: string
  start: string // ISO
  end: string // ISO
  label?: string
}

export type SiteConfig = {
  clientTemplate: string
  prices: Record<Pack, PackPrices>
  adminPasswordHash: string
  blockedWindows: BlockedWindow[]
  // Nombres de campañas de Meta para el menú del campo "campaña" en Venta
  // manual (evita que se escriba a mano con variantes distintas).
  campaigns: string[]
}

const HEX_64_RE = /^[a-f0-9]{64}$/i

function sanitizeHash(o: unknown): string {
  if (typeof o !== "string") return ""
  const trimmed = o.trim().toLowerCase()
  if (!trimmed) return ""
  return HEX_64_RE.test(trimmed) ? trimmed : ""
}

export const DEFAULT_CLIENT_TEMPLATE =
  "¡Hola {nombre}! Soy Kun, de Kunzera. Gracias por reservar tu turno del pack {pack} para el {turno}. Te escribo para coordinar los detalles y comenzar la optimización de tu PC. ¿Te viene bien arrancar en ese horario?"

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  clientTemplate: DEFAULT_CLIENT_TEMPLATE,
  prices: DEFAULT_PRICES,
  adminPasswordHash: "",
  blockedWindows: [],
  campaigns: [],
}

function sanitizeCampaigns(o: unknown): string[] {
  if (!Array.isArray(o)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of o) {
    if (typeof raw !== "string") continue
    const c = raw.trim().slice(0, 80)
    if (!c || seen.has(c.toLowerCase())) continue
    seen.add(c.toLowerCase())
    out.push(c)
    if (out.length >= 50) break
  }
  return out
}

const ENDPOINT = "/api/wa-messages"
const CACHE_KEY = "kunzera:siteConfig"
const CACHE_TTL_MS = 5 * 60 * 1000

type Memo = { config: SiteConfig; ts: number }

let memo: Memo | null = null
let inflight: Promise<SiteConfig> | null = null

function clampPrice(n: unknown, fallback: number): number {
  const v = typeof n === "number" ? n : Number(n)
  if (!Number.isFinite(v) || v < 0) return fallback
  return Math.round(v * 100) / 100
}

function sanitizePackPrices(o: unknown, fallback: PackPrices): PackPrices {
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

function sanitize(o: unknown): SiteConfig {
  const obj = (o ?? {}) as Partial<Record<keyof SiteConfig, unknown>>
  const clientTemplate =
    typeof obj.clientTemplate === "string" && obj.clientTemplate.trim()
      ? obj.clientTemplate.trim()
      : DEFAULT_SITE_CONFIG.clientTemplate
  const pricesIn = (obj.prices ?? {}) as Partial<Record<Pack, unknown>>
  const prices: Record<Pack, PackPrices> = {
    platino: sanitizePackPrices(pricesIn.platino, DEFAULT_SITE_CONFIG.prices.platino),
    diamante: sanitizePackPrices(pricesIn.diamante, DEFAULT_SITE_CONFIG.prices.diamante),
  }
  const adminPasswordHash = sanitizeHash(obj.adminPasswordHash)
  const blockedWindows = sanitizeBlockedWindows(obj.blockedWindows)
  const campaigns = sanitizeCampaigns(obj.campaigns)
  return { clientTemplate, prices, adminPasswordHash, blockedWindows, campaigns }
}

export function applyTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "")
}

function readLocal(): Memo | null {
  if (typeof localStorage === "undefined") return null
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Memo
    if (!parsed?.config || typeof parsed.ts !== "number") return null
    return { config: sanitize(parsed.config), ts: parsed.ts }
  } catch {
    return null
  }
}

function writeLocal(m: Memo) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(m))
  } catch {
    // ignore quota / private mode
  }
}

function publish(config: SiteConfig) {
  setCurrentPrices(config.prices)
}

export function readCachedSiteConfig(): SiteConfig {
  if (memo) {
    publish(memo.config)
    return memo.config
  }
  const local = readLocal()
  if (local) {
    memo = local
    publish(local.config)
    return local.config
  }
  publish(DEFAULT_SITE_CONFIG)
  return DEFAULT_SITE_CONFIG
}

export async function fetchSiteConfig(force = false): Promise<SiteConfig> {
  if (!force && memo && Date.now() - memo.ts < CACHE_TTL_MS) {
    publish(memo.config)
    return memo.config
  }
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await fetch(ENDPOINT, { method: "GET" })
      if (!res.ok) throw new Error(`http_${res.status}`)
      const data = await res.json()
      if (!data?.ok || !data.config) throw new Error("bad_payload")
      const config = sanitize(data.config)
      memo = { config, ts: Date.now() }
      writeLocal(memo)
      publish(config)
      return config
    } catch {
      return readCachedSiteConfig()
    } finally {
      inflight = null
    }
  })()
  return inflight
}

export async function saveSiteConfig(
  config: SiteConfig,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sanitized = sanitize(config)
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: getAdminToken(), config: sanitized }),
    })
    const data = (await res.json().catch(() => null)) as
      | { ok: true; config: SiteConfig }
      | { ok: false; error: string }
      | null
    if (!res.ok || !data?.ok) {
      const error = (data && !data.ok && data.error) || `http_${res.status}`
      return { ok: false, error }
    }
    memo = { config: sanitized, ts: Date.now() }
    writeLocal(memo)
    publish(sanitized)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network" }
  }
}
