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
