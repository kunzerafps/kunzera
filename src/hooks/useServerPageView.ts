import { useEffect } from "react"

function getCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : undefined
}

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
          fbp: getCookie("_fbp"),
          fbc: getCookie("_fbc"),
        }),
      }).catch(() => {})
    }, 400)

    return () => clearTimeout(timer)
  }, [])
}
