import type { OrderDraft } from "../types/order"

// Servicio "Armado de PC": el cliente paga, contesta unas preguntas y a las
// 24-48 hs recibe por WhatsApp qué comprar. NO hay sesión remota ni turno.
//
// El problema: toda la reserva pasa por la planilla (Apps Script), que EXIGE
// `turno` y `discord` y rechaza un turno repetido (Code.gs, submitOrder) — y
// el Apps Script no se toca. Por eso el armado viaja como un pack más, con dos
// convenciones que viven en este archivo:
//
//   1. `turno` = FECHA LÍMITE DE ENTREGA (compra + 48 hs). Nunca cae en un
//      minuto múltiplo de 5, así que no puede coincidir con un turno real de
//      optimización ni sacarle un horario a nadie. En el panel se ve el día
//      en que vence la entrega.
//   2. `discord` = las respuestas del cuestionario, en una sola línea. Ese
//      campo iba siempre con "-" y ya llega a la planilla, al aviso de
//      Discord y a los datos de Mercado Pago.

export const ARMADO_ENTREGA_HS = 48

const MIN = 60 * 1000

// Corre la fecha al próximo minuto que no sea múltiplo de 5.
function fueraDeTurnos(d: Date): Date {
  const out = new Date(d.getTime())
  out.setSeconds(0, 0)
  while (out.getUTCMinutes() % 5 === 0) out.setTime(out.getTime() + MIN)
  return out
}

/** Fecha límite de entrega para un armado comprado en `now`. */
export function armadoDeadline(now: Date = new Date()): string {
  return fueraDeTurnos(new Date(now.getTime() + ARMADO_ENTREGA_HS * 3600 * 1000)).toISOString()
}

/** El minuto libre siguiente — para cuando dos armados caen en el mismo. */
export function bumpArmadoTurno(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return armadoDeadline()
  return fueraDeTurnos(new Date(d.getTime() + MIN)).toISOString()
}

export const ARMADO_MAX_PRESUPUESTO = 60
export const ARMADO_MAX_TEXTO = 200
// La PC actual pide seis datos (procesador, placa, mother, fuente, RAM y
// cooler): necesita más lugar que las otras respuestas.
export const ARMADO_MAX_PC = 300

// Una sola línea, sin saltos, con tope de largo. El "@" se parte con un
// espacio invisible para que un "@everyone" escrito por el cliente no pingee
// al servidor de Discord cuando la planilla manda el aviso.
function limpiar(v: string | undefined, max: number): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .replace(/@/g, "@​")
    .trim()
    .slice(0, max)
}

/**
 * Las respuestas en una línea, para el campo `discord`. Empieza siempre con
 * "ARMADO": así la planilla nunca lo puede leer como una fórmula.
 */
export function armadoResumen(draft: OrderDraft): string {
  const partes = [
    "ARMADO",
    draft.armadoTipo === "mejora" ? "Mejorar la PC que tiene" : "De cero",
    `Presupuesto: ${limpiar(draft.armadoPresupuesto, ARMADO_MAX_PRESUPUESTO) || "-"}`,
  ]
  if (draft.armadoTipo === "mejora") {
    partes.push(`PC actual: ${limpiar(draft.armadoPcActual, ARMADO_MAX_PC) || "-"}`)
  }
  partes.push(`Uso: ${limpiar(draft.armadoUso, ARMADO_MAX_TEXTO) || "-"}`)
  partes.push(`Seguir mejorándola: ${draft.armadoFuturo === "no" ? "no" : "sí"}`)
  return partes.join(" · ")
}

/**
 * Deja el pedido de armado listo para mandar: fecha límite contada desde
 * AHORA (el cuestionario pudo haberse contestado horas antes de pagar) y las
 * respuestas en `discord`. Para cualquier otro pack devuelve el draft igual.
 */
export function prepararArmado(draft: OrderDraft, now: Date = new Date()): OrderDraft {
  if (draft.pack !== "armado") return draft
  return { ...draft, turno: armadoDeadline(now), discord: armadoResumen(draft) }
}

type Resultado = { ok: boolean; error?: string }

/**
 * Manda un armado y, si la planilla contesta "slot_taken" (otro armado cayó
 * en el mismo minuto), reintenta con el minuto siguiente. Reintentar es
 * seguro: la planilla mira primero la clave del pedido, así que si la fila ya
 * existía contesta "ok" en vez de crear otra.
 */
export async function enviarArmadoConReintento<T extends Resultado>(
  turno: string,
  enviar: (turno: string) => Promise<T>,
  intentos = 5,
): Promise<T> {
  let actual = turno
  let res = await enviar(actual)
  for (let i = 1; i < intentos && !res.ok && res.error === "slot_taken"; i++) {
    actual = bumpArmadoTurno(actual)
    res = await enviar(actual)
  }
  return res
}
