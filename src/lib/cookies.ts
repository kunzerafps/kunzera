// Lectura de las cookies que el píxel de Meta deja en el navegador
// (`_fbp` / `_fbc`), centralizada acá para que todos los eventos server-side
// las manden de forma consistente.
//
// `_fbc` en particular llega poco (Meta reporta ~40% de cobertura en las
// compras): la pone el píxel a partir de `?fbclid=...`, y si el píxel está
// bloqueado nunca se crea. El script inline de index.html cubre ese hueco:
// cuando el link del anuncio trae `fbclid` y no hay cookie `_fbc`, la arma a
// mano (`fb.1.<timestamp>.<fbclid>`), la guarda como cookie y además la deja
// en `window.__kunzeraFbc`. `getFbc()` toma cualquiera de las dos fuentes.

export function getCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : undefined
}

export function getFbp(): string | undefined {
  return getCookie("_fbp")
}

export function getFbc(): string | undefined {
  return (
    getCookie("_fbc") ||
    (window as unknown as { __kunzeraFbc?: string }).__kunzeraFbc ||
    undefined
  )
}
