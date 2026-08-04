import type { Context } from "@netlify/functions"
import { getStore } from "@netlify/blobs"
import { verifySessionToken } from "./lib/adminSession"

const STORE_NAME = "comprobantes"
const RATE_LIMIT_STORE = "comprobante-rate-limit"
const RATE_LIMIT_MAX = 10 // subidas
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // por hora, por IP
// Netlify Functions sync tiene un techo duro de 6 MB por request (AWS Lambda).
// El front acepta archivos de hasta 6 MB (constants.ts), pero en base64 eso
// pesa ~8 MB — superaría el techo. Acá se limita más chico (con margen para
// el resto del JSON) para que el rechazo sea un 400 prolijo y no un request
// roto a mitad de camino. Archivos más grandes simplemente no tienen preview
// en el dashboard; el comprobante real igual llega completo a Discord.
const MAX_BYTES = 4 * 1024 * 1024 // 4 MB reales → ~5.3 MB en base64
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "application/pdf",
])
// Coincide con randomId() (crypto.randomUUID, o el fallback alfanumérico)
const KEY_RE = /^[a-zA-Z0-9-]{6,80}$/

// Freno anti-abuso simple: no más de RATE_LIMIT_MAX subidas por hora desde
// la misma IP. No es una defensa perfecta (lectura+escritura no es atómica,
// así que en el peor caso una carrera muy ajustada podría dejar pasar 1-2
// de más), pero alcanza para frenar un abuso accidental o intencional sin
// agregar infraestructura nueva. Si falla Blobs, dejamos pasar la subida
// antes que bloquear gente real por un problema nuestro.
async function isRateLimited(ip: string): Promise<boolean> {
  try {
    const store = getStore(RATE_LIMIT_STORE)
    const now = Date.now()
    const data = (await store.get(ip, { type: "json" })) as
      | { count: number; windowStart: number }
      | null
    if (!data || now - data.windowStart > RATE_LIMIT_WINDOW_MS) {
      await store.setJSON(ip, { count: 1, windowStart: now })
      return false
    }
    if (data.count >= RATE_LIMIT_MAX) {
      return true
    }
    await store.setJSON(ip, { count: data.count + 1, windowStart: data.windowStart })
    return false
  } catch {
    return false
  }
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Cache-Control": "no-store",
  }
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  const headers = corsHeaders()

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers })
  }

  const store = getStore(STORE_NAME)

  if (req.method === "POST") {
    if (await isRateLimited(ctx.ip)) {
      return Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers })
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return Response.json({ ok: false, error: "invalid_json" }, { status: 400, headers })
    }

    const { key, base64, mime } = (body ?? {}) as Record<string, unknown>
    if (typeof key !== "string" || !KEY_RE.test(key)) {
      return Response.json({ ok: false, error: "invalid_key" }, { status: 400, headers })
    }
    if (typeof mime !== "string" || !ALLOWED_MIME.has(mime)) {
      return Response.json({ ok: false, error: "invalid_mime" }, { status: 400, headers })
    }
    if (typeof base64 !== "string" || !base64) {
      return Response.json({ ok: false, error: "missing_file" }, { status: 400, headers })
    }

    const bytes = Buffer.from(base64, "base64")
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
      return Response.json({ ok: false, error: "invalid_size" }, { status: 400, headers })
    }

    // Store.set() sólo tipa string | ArrayBuffer | Blob — convertimos el
    // Buffer a un ArrayBuffer real en vez de confiar en que fetch() lo acepte igual.
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

    await store.set(key, arrayBuffer, { metadata: { mime } })
    return Response.json({ ok: true }, { headers })
  }

  if (req.method === "GET") {
    const url = new URL(req.url)
    const key = url.searchParams.get("key") || ""
    const token = url.searchParams.get("token") || ""
    if (!verifySessionToken(token)) {
      return Response.json({ ok: false, error: "unauthorized" }, { status: 401, headers })
    }
    if (!KEY_RE.test(key)) {
      return Response.json({ ok: false, error: "invalid_key" }, { status: 400, headers })
    }

    const result = await store.getWithMetadata(key, { type: "arrayBuffer" })
    if (!result) {
      return Response.json({ ok: false, error: "not_found" }, { status: 404, headers })
    }

    const mime = (result.metadata?.mime as string) || "application/octet-stream"
    return new Response(result.data, {
      headers: { ...headers, "Content-Type": mime, "Cache-Control": "private, max-age=3600" },
    })
  }

  return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405, headers })
}

export const config = {
  path: "/api/comprobante",
}
