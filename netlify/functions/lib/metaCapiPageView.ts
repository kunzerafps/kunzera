// Envío server-side del evento PageView, como respaldo del píxel de
// navegador (index.html) cuando un bloqueador de anuncios, Safari ITP, etc.
// lo frenan — Meta lo señala en Events Manager como "bajo porcentaje de
// eventos del píxel cubiertos por la API de conversiones".
//
// A propósito NO comparte código con metaCapi.ts (el de Purchase): ese
// archivo tiene lógica delicada (hash de PII, idempotencia de venta,
// event_time histórico) afinada a fuerza de bugs reales encontrados
// probando contra la API real de Meta. Tocarlo para agregar PageView
// arriesgaba una regresión en el tracking de ventas para ganar, a lo sumo,
// unas pocas líneas menos de duplicación. Acá no hace falta "a prueba de
// bloqueadores" en el mismo sentido que Purchase (no hay plata real en
// juego si de vez en cuando se pierde una visita) — por eso esto es
// deliberadamente más simple: sin hash de datos personales (no hay
// nombre/teléfono en este punto) y con su propio store de deduplicación,
// completamente separado del de Purchase.
import { getStore } from "@netlify/blobs"
import { META_PIXEL_ID } from "./metaPixelId"
import { sha256Hex } from "./metaUserData"
import { logMetaResponse } from "./metaResponseLog"

const ALREADY_SENT_STORE = "capi-pageview-events-sent"
const EVENT_SOURCE_URL = "https://kunzera.com/"
// Identifica la integración ante Meta (recomendado por su spec de CAPI).
const PARTNER_AGENT = "kunzera-web"

export type MetaCapiPageView = {
  eventId: string
  fbp?: string
  fbc?: string
  // ID propio y estable del navegador (ver src/lib/visitorId.ts). Es lo
  // único de este evento que Meta espera hasheado — deja unir la visita
  // anónima con una compra posterior aunque se pierda la cookie del píxel.
  externalId?: string
  clientIpAddress?: string
  clientUserAgent?: string
}

export type MetaCapiResult = { ok: true } | { ok: false; error: string }

export async function sendMetaPageViewEvent(params: MetaCapiPageView): Promise<MetaCapiResult> {
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN
  if (!accessToken) return { ok: false, error: "no_access_token" }

  // Misma capa de idempotencia local que Purchase (ver metaCapi.ts) — si el
  // cliente reintenta el POST (ej. por un fetch que se cuelga y el usuario
  // recarga), no gastamos cuota de Meta de nuevo para el mismo eventId.
  try {
    const already = await getStore(ALREADY_SENT_STORE).get(params.eventId, { consistency: "strong" })
    if (already !== null) return { ok: true }
  } catch {
    // Si falla la lectura, seguimos: en el peor caso Meta recibe un
    // duplicado y lo deduplica él mismo por event_id.
  }

  const userData: Record<string, string> = {}
  if (params.fbp) userData.fbp = params.fbp
  if (params.fbc) userData.fbc = params.fbc
  if (params.externalId) {
    userData.external_id = await sha256Hex(params.externalId.trim().toLowerCase())
  }
  if (params.clientIpAddress) userData.client_ip_address = params.clientIpAddress
  if (params.clientUserAgent) userData.client_user_agent = params.clientUserAgent

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // En el deploy de prueba va a "Eventos de prueba" de Meta, igual
          // que el resto de los eventos server-side.
          ...(process.env.META_CAPI_TEST_EVENT_CODE
            ? { test_event_code: process.env.META_CAPI_TEST_EVENT_CODE }
            : {}),
          data: [
            {
              event_name: "PageView",
              event_time: Math.floor(Date.now() / 1000),
              action_source: "website",
              event_source_url: EVENT_SOURCE_URL,
              event_id: params.eventId,
              partner_agent: PARTNER_AGENT,
              user_data: userData,
            },
          ],
        }),
        signal: controller.signal,
      },
    )

    if (!res.ok) {
      const errText = await res.text().catch(() => "")
      const error = `http_${res.status}: ${errText}`
      console.error("[metaCapiPageView] Meta rechazó el evento:", error)
      return { ok: false, error }
    }

    await logMetaResponse(res, "metaCapiPageView")

    try {
      await getStore(ALREADY_SENT_STORE).set(params.eventId, "1")
    } catch (err) {
      console.error("[metaCapiPageView] no se pudo marcar el evento como enviado:", err)
    }

    return { ok: true }
  } catch (err) {
    console.error("[metaCapiPageView] error inesperado mandando el evento:", err)
    return { ok: false, error: String(err) }
  } finally {
    clearTimeout(timer)
  }
}
