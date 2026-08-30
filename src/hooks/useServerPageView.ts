import { useEffect } from "react"
import { getFbp, getFbc } from "../lib/cookies"
import { getVisitorId } from "../lib/visitorId"
import { isStaffSession } from "../lib/pixel"

// Manda a Meta, desde el servidor, el mismo PageView que index.html ya
// manda desde el navegador — comparten eventID (generado ahí, guardado en
// window.__kunzeraPvId) para que Meta los trate como un solo evento
// deduplicado, no como dos visitas.
//
// El único guard contra el doble-mount que hace React StrictMode en
// desarrollo es el setTimeout/clearTimeout de abajo (el primer timer se
// cancela en el cleanup, sobrevive el del segundo mount) — a propósito NO
// hay un flag de módulo tipo "alreadySent" además de eso: con StrictMode
// el flag quedaba en true ANTES de que el segundo mount (el real) llegara
// a armar su propio timer, así que el fetch terminaba sin dispararse
// nunca en desarrollo (bug real, encontrado en review).
export function useServerPageView(): void {
  useEffect(() => {
    // Sesión interna (panel de admin / dispositivo del equipo): no mandar el
    // PageView server-side. El de index.html tampoco se dispara en ese caso
    // (misma lógica, duplicada allá). Ver isStaffSession.
    if (isStaffSession()) return
    const pvId = (window as unknown as { __kunzeraPvId?: string }).__kunzeraPvId
    if (!pvId) return

    // Pequeña espera: fbevents.js carga async y recién cuando termina pone
    // la cookie _fbp. Si a los 400ms todavía no está, se manda igual sin
    // fbp — degrada el matching, no bloquea el evento (ver
    // metaCapiPageView.ts, mismo criterio de "mejor esfuerzo" que Purchase
    // usa para fbp/fbc).
    const timer = setTimeout(() => {
      void fetch("/api/capi-pageview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: pvId,
          fbp: getFbp(),
          fbc: getFbc(),
          // ID propio del navegador (external_id) — es lo que le deja a Meta
          // unir esta visita con una compra posterior aunque se pierda la
          // cookie del píxel en el medio.
          externalId: getVisitorId(),
        }),
        // CLAVE. Sin esto el navegador MATA el pedido si la página se
        // descarga antes de que termine, y acá eso pasa todo el tiempo: el
        // envío arranca recién a los 400ms (esperando la cookie _fbp) y
        // mucha gente que llega de un anuncio rebota o toca un link antes.
        //
        // Se nota en los datos de Meta: la geo del PageView (que solo puede
        // venir de esta copia server-side) llegaba al ~30%, mientras que en
        // ViewContent —mismo origen de geo, pero disparado cuando la persona
        // ya está navegando— llega al 96%. El PageView del navegador sí
        // salía siempre, así que la visita se contaba igual: lo que faltaba
        // era la mitad rica del dato (IP real, geo, resistencia a
        // bloqueadores), justo en el tráfico pago.
        keepalive: true,
      }).catch(() => {})
    }, 400)

    return () => clearTimeout(timer)
  }, [])
}
