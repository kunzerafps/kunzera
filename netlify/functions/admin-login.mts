import type { Context } from "@netlify/functions"
import { timingSafeEqual } from "node:crypto"
import { getStore } from "@netlify/blobs"
import { ADMIN_PASSWORD_HASH } from "../../src/lib/constants"
import { createSessionToken } from "./lib/adminSession"

const CONFIG_STORE = "site-config"
const CONFIG_KEY = "site-config"
const RATE_LIMIT_STORE = "admin-login-rate-limit"
const RATE_LIMIT_MAX = 8 // intentos
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // por IP, cada 15 min

const HEX_64_RE = /^[a-f0-9]{64}$/i

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

// Mismo patrón que isRateLimited en comprobante.mts — no es una defensa
// perfecta (lectura+escritura no atómica), pero alcanza para frenar un
// intento de fuerza bruta contra la contraseña del panel sin agregar
// infraestructura nueva. Si Blobs falla, se deja pasar el intento antes
// que trabar el login real de un problema nuestro.
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
    if (data.count >= RATE_LIMIT_MAX) return true
    await store.setJSON(ip, { count: data.count + 1, windowStart: data.windowStart })
    return false
  } catch {
    return false
  }
}

// Único punto de entrada para autenticarse como admin. Antes, el panel
// comparaba la contraseña contra el hash del lado del cliente y con eso
// alcanzaba para siempre — no había ningún servidor de por medio. Ahora el
// servidor es quien decide, y lo que devuelve no es la contraseña ni un
// token fijo reutilizable para siempre, sino una sesión firmada con
// vencimiento (ver adminSession.ts).
export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 })
  }

  if (await isRateLimited(ctx.ip)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 })
  }

  const passwordHash = (body as { passwordHash?: unknown })?.passwordHash
  if (typeof passwordHash !== "string" || !HEX_64_RE.test(passwordHash)) {
    return Response.json({ ok: false, error: "invalid_body" }, { status: 400 })
  }

  // Mismo fallback que antes tenía el cliente (useAdminGate.ts): el hash
  // guardado en la config del sitio manda si existe, si no se usa el
  // default hardcodeado — para que el panel siga funcionando incluso si
  // nunca se guardó una config custom.
  let saved = ""
  try {
    const store = getStore(CONFIG_STORE)
    const data = (await store.get(CONFIG_KEY, { type: "json" })) as
      | { adminPasswordHash?: unknown }
      | null
    if (typeof data?.adminPasswordHash === "string" && HEX_64_RE.test(data.adminPasswordHash)) {
      saved = data.adminPasswordHash.toLowerCase()
    }
  } catch {
    // sigue con el fallback de abajo
  }
  const expected = saved || ADMIN_PASSWORD_HASH

  if (!safeEqual(passwordHash.toLowerCase(), expected.toLowerCase())) {
    return Response.json({ ok: false, error: "wrong_password" }, { status: 401 })
  }

  const token = createSessionToken()
  if (!token) {
    console.error("[admin-login] ADMIN_SESSION_SECRET no está configurado")
    return Response.json({ ok: false, error: "not_configured" }, { status: 500 })
  }

  return Response.json({ ok: true, token })
}

export const config = {
  path: "/api/admin-login",
}
