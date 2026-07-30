import { ADMIN_SECRET_TOKEN } from "./constants"

const COMPROBANTE_URL = "/api/comprobante"

// Debe coincidir con MAX_BYTES en netlify/functions/comprobante.mts (4 MB
// reales). En base64 eso son ~4/3 caracteres por byte.
const MAX_PREVIEW_BASE64_CHARS = Math.floor((4 * 1024 * 1024 * 4) / 3)

// Sube el comprobante a Netlify Blobs (solo para preview en el dashboard).
// No es la vía crítica: el comprobante real ya viaja a Discord vía Apps
// Script, así que si esto falla (o el archivo es muy grande para el límite
// de 6 MB por request de Netlify Functions) no se reintenta ni se avisa al
// cliente — el turno se reserva igual, simplemente no hay preview.
export async function uploadComprobante(
  key: string,
  file: { base64: string; mime: string },
): Promise<boolean> {
  if (file.base64.length > MAX_PREVIEW_BASE64_CHARS) return false
  try {
    const res = await fetch(COMPROBANTE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, base64: file.base64, mime: file.mime }),
    })
    if (!res.ok) return false
    const data = await res.json()
    return !!(data as { ok?: boolean })?.ok
  } catch {
    return false
  }
}

export function comprobanteUrl(key: string): string {
  return `${COMPROBANTE_URL}?key=${encodeURIComponent(key)}&token=${encodeURIComponent(ADMIN_SECRET_TOKEN)}`
}
