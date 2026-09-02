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

// ─────────────────────────────────────────────────────────────────────────
// Teléfono que se le manda a META como `ph`.
//
// Es DISTINTA de normalizePhoneForHash de arriba, y a propósito:
//
//   - normalizePhoneForHash arma CLAVES (el event_id determinístico de las
//     ventas manuales y la clave del índice attribution-by-phone). Una clave
//     solo tiene que ser estable, no correcta: si se cambia, una venta ya
//     cargada pasa a calcular otro event_id y Meta la puede contar DOS
//     VECES. Por eso queda congelada tal cual está.
//   - esta función arma el DATO que viaja a Meta, que sí tiene que ser
//     correcto o no coincide con nadie.
//
// Qué arregla respecto de la otra (los tres casos producían un hash con
// forma válida que Meta contaba como "dato provisto" y que no coincidía con
// ningún usuario jamás — peor que no mandar nada, porque infla la cobertura
// de parámetros del dataset con señal muerta):
//
//   a) Número de otro país ("+56 9 1234 5678"): se le anteponía "549"
//      igual, quedando "54956912345678". Ahora se pasa tal cual, que es el
//      formato internacional que Meta espera.
//   b) Prefijo internacional a la vieja usanza ("0054 9 11 ..."): no
//      entraba por la rama del código de país (empieza con "005"), caía en
//      la del "0" de larga distancia y terminaba en 17 dígitos. Ahora el
//      "00" se saca ANTES de mirar el código de país.
//   c) Basura o número incompleto (" ", "12", 8 dígitos sin código de
//      área): devolvía "549" + lo que hubiera. Ahora devuelve undefined y
//      el llamador simplemente no manda `ph`.
//
// Devuelve undefined cuando no se puede afirmar que sea un teléfono real.
export function normalizePhoneForMeta(whatsapp: string): string | undefined {
  let digits = (whatsapp ?? "").replace(/\D/g, "")
  if (!digits) return undefined

  // (b) "00" = prefijo internacional. Va primero, si no deforma el resto.
  if (digits.startsWith("00")) digits = digits.slice(2)

  // Forma internacional del número, antes de intentar leerlo como argentino.
  // Se guarda para el fallback de (a) más abajo.
  const international = digits

  let hadArCountryCode = false
  if (digits.startsWith("549")) {
    digits = digits.slice(3)
    hadArCountryCode = true
  } else if (digits.startsWith("54") && digits.length > 10) {
    digits = digits.slice(2)
    hadArCountryCode = true
  }

  // "0" de larga distancia local. Sin condicionar al código de país, igual
  // que normalizePhoneForHash — hay quien escribe "+54 9 011 ...".
  if (digits.startsWith("0")) digits = digits.slice(1)

  // "15" pre-unificación, mismo criterio exacto que normalizePhoneForHash
  // (ver el comentario largo allá arriba): se saca sólo cuando queda un
  // número argentino de 10 dígitos, para no comerse un "15" legítimo.
  for (const areaLen of [2, 3, 4]) {
    if (digits.length === 12 && digits.slice(areaLen, areaLen + 2) === "15") {
      digits = digits.slice(0, areaLen) + digits.slice(areaLen + 2)
      break
    }
  }

  // Un celular argentino es código de área + número local = 10 dígitos, y
  // todos los códigos de área del país empiezan con 1, 2 o 3 (11 el AMBA,
  // 2xx/2xxx y 3xx/3xxx el resto). Ese chequeo es el que evita que un
  // número extranjero que por casualidad quedó en 10 dígitos se disfrace de
  // argentino.
  if (digits.length === 10 && /^[123]/.test(digits)) return "549" + digits

  // (a) No se pudo leer como argentino pero ya trae su propio código de
  // país: se manda tal cual. Meta pide dígitos en formato internacional, y
  // así un cliente de Chile o Uruguay al menos tiene chance de coincidir.
  if (!hadArCountryCode && international.length >= 11 && international.length <= 15) {
    return international
  }

  // (c) Ni argentino ni internacional plausible: mejor no mandar nada.
  return undefined
}
