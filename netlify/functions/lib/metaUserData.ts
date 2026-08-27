// Helpers puros para armar el `user_data` que espera Meta (hash de PII,
// normalización de teléfono, limpieza de acentos). Viven en su propio
// archivo para que los tres caminos que le mandan eventos a Meta desde el
// servidor los usen sin duplicar la lógica delicada:
//   - metaCapi.ts          -> Purchase
//   - metaCapiFunnel.ts    -> Lead / InitiateCheckout (mid-funnel)
//   - metaCapiPageView.ts  -> PageView (solo usa sha256Hex, para external_id)
//
// Son funciones puras (sin red ni Blobs) — a propósito no arrastran nada de
// la complejidad de idempotencia / event_time histórico de metaCapi.ts.
// Cambiar el hashing acá cambia el matching de TODOS los eventos, así que
// está cubierto por metaUserData.test.ts con cálculos independientes.

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

// Meta espera fn/ln/ct/st sin acentos ni diacríticos (documentado en su
// spec de Advanced Matching/CAPI) — Unicode NFD separa cada letra acentuada
// en base + marca combinante, y se descarta la marca. "ñ" también cae acá
// (se descompone en "n" + tilde combinante).
export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036F]/g, "")
}

// Normaliza a como Meta espera el teléfono para el hash: sólo dígitos, con
// código de país, sin el "0" de larga distancia local (ej. "011 2345-6789"
// -> "1123456789" antes de anteponer "549"). Mismo criterio de "549" que ya
// usa el panel admin para armar links de WhatsApp (OrderDetailModal.tsx).
export function normalizePhoneForHash(whatsapp: string): string {
  let digits = whatsapp.replace(/\D/g, "")
  if (digits.startsWith("549")) digits = digits.slice(3)
  else if (digits.startsWith("54") && digits.length > 10) digits = digits.slice(2)
  if (digits.startsWith("0")) digits = digits.slice(1)
  // "15" pre-unificación: mucha gente todavía dicta el número como
  // "<código de área> 15 <número local>" (ej. "3382 15 677871") — ese "15"
  // no es parte del número real, Meta nunca lo va a tener así en el
  // perfil del usuario, y dejarlo adentro del hash rompe el matching. Se
  // busca justo después de un código de área de 2 a 4 dígitos y se saca,
  // solo cuando eso deja exactamente los 10 dígitos esperados (código de
  // área + número local) — evita tocar un "15" que sea parte legítima de
  // otro número por casualidad.
  for (const areaLen of [2, 3, 4]) {
    if (digits.length === 12 && digits.slice(areaLen, areaLen + 2) === "15") {
      digits = digits.slice(0, areaLen) + digits.slice(areaLen + 2)
      break
    }
  }
  return "549" + digits
}
