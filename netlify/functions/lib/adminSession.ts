import { createHmac, timingSafeEqual } from "node:crypto"

// Reemplaza el viejo esquema de un token fijo escrito en el código del
// cliente (ADMIN_SECRET_TOKEN, todavía visible en el bundle público para
// quien abra las devtools) por una sesión firmada del lado del servidor:
// el cliente manda la contraseña una vez a /api/admin-login, y si es
// correcta recibe un token opaco con vencimiento, firmado con un secreto
// que nunca sale del servidor. Sin ADMIN_SESSION_SECRET, nadie puede
// forjar un token válido aunque conozca el formato — a diferencia del
// viejo esquema, donde ver el token EN el bundle alcanzaba para usarlo.
const SESSION_TTL_MS = 12 * 60 * 60 * 1000 // 12hs: dura una jornada de atención sin repetir login, sin quedar abierto para siempre si el dispositivo se pierde o se comparte.

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("hex")
}

export function createSessionToken(): string | null {
  const secret = process.env.ADMIN_SESSION_SECRET
  if (!secret) return null
  const payload = JSON.stringify({ exp: Date.now() + SESSION_TTL_MS })
  const payloadB64 = Buffer.from(payload).toString("base64url")
  return `${payloadB64}.${sign(payloadB64, secret)}`
}

export function verifySessionToken(token: unknown): boolean {
  const secret = process.env.ADMIN_SESSION_SECRET
  if (!secret || typeof token !== "string") return false

  const dot = token.indexOf(".")
  if (dot < 0) return false
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!payloadB64 || !sig) return false

  const expected = sign(payloadB64, secret)
  const bufSent = Buffer.from(sig)
  const bufExpected = Buffer.from(expected)
  if (bufSent.length !== bufExpected.length) return false
  if (!timingSafeEqual(bufSent, bufExpected)) return false

  try {
    const { exp } = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
      exp?: number
    }
    return typeof exp === "number" && exp > Date.now()
  } catch {
    return false
  }
}
