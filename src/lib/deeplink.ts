import { openChat } from "./chatBus"
import { PACKS } from "./packs"
import type { Pack } from "../types/order"
import { getFbc } from "./cookies"
import { getStoredUtm } from "./utm"

// Deep-links para los anuncios. El problema: el anuncio manda a la portada
// y la persona tiene que buscar el precio o el botón de reserva a mano —
// o, peor, toca el ícono de WhatsApp y se queda esperando respuesta. Estos
// links la dejan directo en lo que vino a hacer.
//
//   kunzera.com/packs             -> baja a la seccion de planes (#pricing)
//   kunzera.com/reservar          -> abre el chat directo en "reservar turno"
//   kunzera.com/reservar/platino  -> abre el chat con Platino ya elegido
//   kunzera.com/reservar/diamante -> abre el chat con Diamante ya elegido
//   kunzera.com/packs/diamante    -> idem (alias)
//
// Alias por query, por si un anuncio arma el link con ?pack= en vez de path:
//   kunzera.com/?pack=platino  ·  kunzera.com/packs?plan=diamante
//
// Netlify ya reescribe cualquier ruta a index.html (SPA fallback en
// netlify.toml), asi que estas URLs cargan la web normal y este modulo
// decide que hacer segun el path. Se llama una sola vez, al montar <App>.

const PACK_SLUGS: Record<string, Pack> = {
  platino: "platino",
  diamante: "diamante",
}

// Paths que llevan a la seccion de planes.
const PACKS_PATHS = new Set(["packs", "planes", "precios", "pricing", "plan"])

// Paths que abren el chat directo en el flujo de reserva.
const RESERVAR_PATHS = new Set([
  "reservar",
  "reserva",
  "reservar-ahora",
  "reservar-turno",
  "turno",
])

function scrollToPricing(): void {
  // Doble rAF: espera a que <section id="pricing"> este montada y con
  // layout antes de calcular el scroll.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document
        .getElementById("pricing")
        ?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
  })
}

// Saca la ruta de reserva de la barra de direcciones para que un F5 no
// vuelva a abrir el chat solo. Deja los utm y cualquier #hash; tambien
// borra los alias ?pack=/?plan= ya consumidos (si no, en un link tipo
// "/?pack=platino" el path ya es "/" y el refresh los volveria a leer).
function cleanPath(): void {
  try {
    const q = new URLSearchParams(window.location.search)
    q.delete("pack")
    q.delete("plan")
    const qs = q.toString()
    window.history.replaceState(
      null,
      "",
      "/" + (qs ? "?" + qs : "") + window.location.hash,
    )
  } catch {
    /* history no disponible — no rompe nada */
  }
}

export function handleDeepLink(): void {
  if (typeof window === "undefined") return

  const params = new URLSearchParams(window.location.search)

  // El regreso desde Mercado Pago vuelve a "/?mp=success&ref=..." — eso lo
  // maneja useChatFlow, no lo tocamos.
  if (params.has("mp")) return

  const segments = window.location.pathname
    .split("/")
    .filter(Boolean)
    .map((s) => s.toLowerCase())
  const [first, second] = segments

  const packParam = (params.get("pack") || params.get("plan") || "").toLowerCase()
  const packFromPath =
    first && (RESERVAR_PATHS.has(first) || PACKS_PATHS.has(first))
      ? PACK_SLUGS[second]
      : undefined
  const pack = packFromPath || PACK_SLUGS[packParam]

  // 1) Pack explicito -> abre el chat con ese pack ya seleccionado.
  if (pack) {
    openChat({ pack, auto: true })
    cleanPath()
    return
  }

  if (!first) return

  // 2) Reservar turno directo -> abre el chat en el flujo de reserva.
  if (RESERVAR_PATHS.has(first)) {
    openChat({ startReservation: true, auto: true })
    cleanPath()
    return
  }

  // 3) Ver planes -> baja a la seccion de precios. El path /packs se deja
  //    en la URL a proposito: recargar y volver a bajar no molesta y queda
  //    prolijo para compartir.
  if (PACKS_PATHS.has(first)) {
    scrollToPricing()
  }
}

// Referencia rapida de los links armados, para pegar en los anuncios.
// (No se usa en runtime — es documentacion viva junto al codigo que la
// implementa.)
export const DEEP_LINKS = {
  packs: "https://kunzera.com/packs",
  reservar: "https://kunzera.com/reservar",
  reservarPlatino: `https://kunzera.com/reservar/${PACKS.platino.id}`,
  reservarDiamante: `https://kunzera.com/reservar/${PACKS.diamante.id}`,
} as const

// Saca el fbclid crudo (el que Meta necesita para reconstruir la cookie
// `_fbc`): primero del link actual, y si ya no esta ahi, de la propia cookie
// `_fbc` que tiene el formato `fb.1.<timestamp>.<fbclid>` — el fbclid es
// TODO lo que viene despues del 3er punto (puede contener puntos, por eso no
// se usa split().pop()).
function readFbclid(): string | undefined {
  const fromUrl = new URLSearchParams(window.location.search).get("fbclid")
  if (fromUrl) return fromUrl
  const fbc = getFbc()
  if (!fbc) return undefined
  const parts = fbc.split(".")
  return parts.length > 3 ? parts.slice(3).join(".") : undefined
}

// Link de regreso para dejar pre-escrito en el mensaje del boton flotante de
// WhatsApp (ver WhatsAppFloat.tsx). El problema que resuelve: cuando alguien
// que vino de un anuncio toca WhatsApp en vez de reservar en el sitio, se va
// a la app de WhatsApp y despues vuelve por un link que le pasan en el chat,
// abierto en OTRO navegador (Chrome/Safari) donde ya no esta la cookie
// `_fbc` con la que Meta le atribuye la compra al anuncio. Este link lleva
// de nuevo el `fbclid` (y los utm) en la query: el script inline de
// index.html los ve al cargar y reconstruye `_fbc`, asi la compra que se
// cierra despues sigue contando para el anuncio que la trajo.
//
// Devuelve null si no hay nada que arrastrar (visita organica, sin fbclid ni
// utm) — en ese caso el mensaje de WhatsApp queda igual que siempre, sin
// sumarle un link ruidoso.
export function buildAdReturnLink(): string | null {
  if (typeof window === "undefined") return null

  const params = new URLSearchParams(window.location.search)
  // Los utm sobreviven la navegacion dentro del sitio via sessionStorage
  // (ver utm.ts) aunque el link ya no los tenga; el del link actual gana.
  const utm = getStoredUtm()
  const fbclid = readFbclid()
  const utmSource = params.get("utm_source") || utm.utm_source
  const utmMedium = params.get("utm_medium") || utm.utm_medium
  const utmCampaign = params.get("utm_campaign") || utm.utm_campaign

  if (!fbclid && !utmSource) return null

  const q = new URLSearchParams()
  if (fbclid) q.set("fbclid", fbclid)
  if (utmSource) q.set("utm_source", utmSource)
  if (utmMedium) q.set("utm_medium", utmMedium)
  if (utmCampaign) q.set("utm_campaign", utmCampaign)

  return `${DEEP_LINKS.reservar}?${q.toString()}`
}

// Le suma a un mensaje de WhatsApp pre-escrito el link de regreso con
// fbclid+utm, SOLO si la visita vino de un anuncio. Si no, devuelve el
// mensaje igual. Un unico lugar para no repetir el mismo ternario en el
// boton flotante, el footer y los botones "Ir a WhatsApp" del chat.
export function withAdReturnLink(message: string): string {
  const back = buildAdReturnLink()
  return back
    ? `${message}\n\n» Si querés reservar directo, entrá acá: ${back}`
    : message
}
