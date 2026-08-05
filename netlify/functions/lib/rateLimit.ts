import { getStore } from "@netlify/blobs"

// Freno simple por IP, mismo criterio que ya usa comprobante.mts: no es una
// defensa perfecta (lectura+escritura no es atómica, así que en el peor
// caso una carrera muy ajustada podría dejar pasar 1-2 de más), pero
// alcanza para frenar un abuso accidental o un token de sesión filtrado sin
// agregar infraestructura nueva. Si falla Blobs, dejamos pasar el request
// antes que bloquear un uso legítimo por un problema nuestro.
export async function isRateLimited(
  storeName: string,
  ip: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  try {
    const store = getStore(storeName)
    const now = Date.now()
    const data = (await store.get(ip, { type: "json" })) as
      | { count: number; windowStart: number }
      | null
    if (!data || now - data.windowStart > windowMs) {
      await store.setJSON(ip, { count: 1, windowStart: now })
      return false
    }
    if (data.count >= max) return true
    await store.setJSON(ip, { count: data.count + 1, windowStart: data.windowStart })
    return false
  } catch {
    return false
  }
}
