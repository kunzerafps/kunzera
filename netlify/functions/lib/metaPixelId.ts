// Único lugar server-side que define el Pixel ID de Meta — compartido por
// metaCapi.ts (Purchase) y metaCapiPageView.ts (PageView). Antes cada uno
// tenía su propia copia hardcodeada del mismo fallback; se unifica acá para
// que rotar/migrar el Pixel solo requiera tocar un lugar de este lado del
// servidor. Esto es solo una constante de configuración, no lógica de
// negocio — compartirla no contradice la separación deliberada entre
// metaCapi.ts y metaCapiPageView.ts (ver el comentario al inicio de ese
// archivo).
//
// OJO: `index.html` (client-side) NO puede leer esta misma variable — es
// HTML estático, sin templating de build acá. Si alguna vez se migra el
// Pixel a otro dataset, hay que actualizar TAMBIÉN el `fbq('init', ...)` en
// index.html a mano y mantenerlo igual a esto.
export const META_PIXEL_ID = process.env.META_PIXEL_ID || "761377043609509"

// Versión de la Graph API, en UN solo lugar. Estaba repetida a mano en 5
// archivos (metaCapi, metaCapiFunnel, metaCapiPageView, metaCapiCancel,
// metaAdSpend), y eso es una bomba de tiempo con fecha conocida: Meta da de
// baja cada versión ~2 años después de publicarla (v21.0 salió en octubre de
// 2024). El día que la corten, TODOS los eventos empiezan a fallar a la vez
// y había que acordarse de tocar los 5 lugares.
//
// Para subirla: cambiar acá, mirar el changelog de Meta por si algún campo
// cambió de forma, y verificar en el Administrador de eventos que sigan
// entrando Purchase y los del embudo.
export const META_GRAPH_VERSION = "v21.0"

// URL del endpoint de eventos (Conversions API) del pixel. Todos los módulos
// que mandan eventos la usan, así no puede volver a divergir.
export function metaEventsUrl(accessToken: string): string {
  return `https://graph.facebook.com/${META_GRAPH_VERSION}/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(accessToken)}`
}
