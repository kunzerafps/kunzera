import { getFbc, getFbp } from "./cookies"
import { isStaffSession } from "./pixel"
import { getStoredUtm } from "./utm"
import { getVisitorId } from "./visitorId"

// Guarda el "rastro del anuncio" del comprador (cookies _fbp/_fbc que puso el
// propio píxel de Meta, id de visitante, utm) contra el número interno del
// pedido. El servidor le suma la IP y el user-agent reales
// (capture-attribution.mts). Es la ÚNICA foto de la identidad del comprador:
// para transferencia y Binance el evento de Compra se manda días después,
// cuando el admin marca "atendido", y ahí ya no hay ninguna sesión de
// navegador de la que sacar estos datos.
//
// Por qué esto se rompía (medido en el Event Match Quality del pixel: Lead e
// InitiateCheckout llegan con fbp/external_id/IP al 100%, pero la Compra del
// mismo comprador minutos después al 50-60%):
//
//  1. `keepalive` — era un fetch normal disparado al abrir la pantalla de
//     pago. Si la persona tocaba "Pagar con Mercado Pago" enseguida, la
//     página se iba a MP y el navegador MATABA el pedido en vuelo. Con
//     keepalive el navegador se compromete a entregarlo igual aunque la
//     página se descargue. Este era el agujero grande.
//  2. Reintento — antes era `.catch(() => {})`, un solo tiro y mudo. Un
//     microcorte de red y esa venta quedaba sin rastro para siempre.
//
// Es idempotente: escribe siempre sobre la misma clave, así que llamarla de
// más no rompe nada (por eso se la vuelve a llamar en cada entrada a la
// pantalla de pago, como red de seguridad).
const RETRY_DELAY_MS = 2000
const MAX_ATTEMPTS = 2

export async function captureAttribution(
  idempotencyKey: string,
  // Mail opcional que dejó la persona en el chat. Viaja por acá y NO por el
  // Apps Script: el campo `email` de ese payload es un honeypot anti-spam
  // (Code.gs:108 rechaza la reserva entera con "spam_detected" si viene con
  // algo). capi-confirmar-pago lo lee de este blob y lo suma al evento de
  // Compra — es la señal que más sube la calidad de coincidencia en Meta.
  email?: string,
): Promise<boolean> {
  if (!idempotencyKey) return false
  // Corte de sesión interna. Era el ÚNICO envío de tracking del sitio que no
  // lo tenía (los otros cuatro sí: pixel.ts, useServerPageView.ts,
  // index.html). Una reserva de prueba hecha con el panel abierto guardaba
  // las cookies del propio equipo contra ese pedido, y al marcarlo "atendido"
  // salía una Compra matcheada contra ellos: no infla el conteo de ventas,
  // pero mete al equipo en el público de compradores de Meta.
  if (isStaffSession()) return false

  const utm = getStoredUtm()
  const body = JSON.stringify({
    idempotencyKey,
    fbp: getFbp(),
    fbc: getFbc(),
    visitorId: getVisitorId(),
    email,
    utm_source: utm.utm_source,
    utm_medium: utm.utm_medium,
    utm_campaign: utm.utm_campaign,
  })

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
    }
    try {
      const res = await fetch("/api/capture-attribution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        // Sobrevive a que la página se descargue (redirect a Mercado Pago,
        // cerrar la pestaña). Es el motivo principal de este archivo.
        keepalive: true,
      })
      if (res.ok) return true
    } catch {
      // Red caída o navegación en curso — se reintenta una vez.
    }
  }
  return false
}
