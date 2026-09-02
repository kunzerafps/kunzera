// Helper compartido por los tres caminos que le mandan eventos a Meta
// (metaCapi.ts / metaCapiFunnel.ts / metaCapiPageView.ts) para NO tirar la
// respuesta 2xx de la Graph API. Meta puede aceptar el request (HTTP 200) y
// aún así devolver en el cuerpo:
//   - `events_received`: cuántos eventos entró de verdad (si es 0, algo se
//     descartó en silencio).
//   - `messages`: advertencias no fatales (un parámetro ignorado, PII con
//     formato raro, un campo desconocido). Antes esto no se miraba nunca, así
//     que un evento "aceptado pero degradado" no dejaba ningún rastro.
//   - `fbtrace_id`: id para pegar en un ticket de soporte de Meta.
//
// Las ADVERTENCIAS siguen siendo sólo logging (una advertencia no es un
// fallo). Pero `events_received: 0` sí se devuelve al que llama: eso no es
// una advertencia, es que el evento no existe para Meta, y quien lo mandó
// tiene que poder decidir no marcarlo como entregado. Best-effort y a prueba
// de todo — si el cuerpo no es JSON, o ya se consumió, se informa "no sé" y
// el caller sigue como antes.
//
// `eventsReceivedZero` es true SÓLO si Meta dijo explícitamente 0. Si el
// campo no viene, es false (conservador: no romper un envío que funciona).

type MetaEventsResponse = {
  events_received?: number
  messages?: unknown[]
  fbtrace_id?: string
}

export type MetaResponseInfo = { eventsReceivedZero: boolean }

export async function logMetaResponse(res: Response, context: string): Promise<MetaResponseInfo> {
  try {
    const raw = await res.clone().text()
    if (!raw) return { eventsReceivedZero: false }
    let parsed: MetaEventsResponse
    try {
      parsed = JSON.parse(raw) as MetaEventsResponse
    } catch {
      return { eventsReceivedZero: false }
    }

    const messages = Array.isArray(parsed.messages) ? parsed.messages : []
    if (messages.length > 0) {
      console.warn(
        `[${context}] Meta aceptó el evento con advertencias:`,
        JSON.stringify(messages),
        parsed.fbtrace_id ? `(fbtrace_id ${parsed.fbtrace_id})` : "",
      )
    }
    if (parsed.events_received === 0) {
      console.warn(
        `[${context}] Meta respondió 2xx pero events_received=0 — el evento no se contabilizó.`,
        parsed.fbtrace_id ? `(fbtrace_id ${parsed.fbtrace_id})` : "",
      )
      return { eventsReceivedZero: true }
    }
  } catch {
    // Nunca romper el flujo por un problema al loguear la respuesta.
  }
  return { eventsReceivedZero: false }
}
