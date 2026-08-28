import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import {
  FlowContext,
  GREETING,
  initialContext,
  isExpanded,
  reduce,
} from "../lib/chatFlow"
import type { FlowEvent } from "../types/order"
import {
  canResume,
  clearDraft,
  clearFiredOnceInSession,
  clearTurnoSelFired,
  loadDraft,
  saveDraft,
} from "../lib/storage"
import { trackServerBackedEvent } from "../lib/pixel"
import { packEventParams } from "../lib/prices"

// Demora simulada del "escribiendo…": corta, sólo para que se lea como "el
// bot está respondiendo" y no como una página trabada. Antes eran 700ms al
// saludar + 600ms en CADA paso del usuario — en un flujo de reserva eso se
// siente lento sin necesidad (la velocidad vende). 0ms si el visitante pidió
// reducir animaciones.
const GREETING_DELAY_MS = 250
const STEP_DELAY_MS = 200

function typingDelay(ms: number): number {
  try {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return 0
  } catch {
    // matchMedia no disponible — se usa el default
  }
  return ms
}

type FlowReturn = {
  ctx: FlowContext
  dispatch: (ev: FlowEvent) => void
  typing: boolean
  resumable: ReturnType<typeof loadDraft>
  resumeDraft: () => void
  discardDraft: () => void
  open: boolean
  setOpen: (open: boolean) => void
  forceExpanded: boolean
  setForceExpanded: (v: boolean) => void
}

// Envuelve el reducer y le agrega typing simulado + hidratación
export function useChatFlow(): FlowReturn {
  const [ctx, rawDispatch] = useReducer(reduce, undefined, initialContext)
  const [typing, setTyping] = useState(false)
  const [open, setOpen] = useState(false)
  const [forceExpanded, setForceExpanded] = useState(false)
  const [resumable, setResumable] = useState(() => loadDraft())
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const greeted = useRef(false)
  const scheduleFired = useRef(false)

  const dispatch = useCallback((ev: FlowEvent) => {
    const isUserMove =
      ev.type === "SELECT_CHIP" ||
      ev.type === "FREE_TEXT" ||
      ev.type === "PICK_PACK" ||
      ev.type === "SET_NAME" ||
      ev.type === "SET_WHATSAPP" ||
      ev.type === "SET_DISCORD" ||
      ev.type === "PICK_SLOT" ||
      ev.type === "CONFIRM_REVIEW" ||
      ev.type === "CONFIRM_PAYMENT"

    if (isUserMove) {
      if (typingTimer.current) clearTimeout(typingTimer.current)
      setTyping(true)
      typingTimer.current = setTimeout(() => {
        rawDispatch(ev)
        setTyping(false)
      }, typingDelay(STEP_DELAY_MS))
    } else {
      rawDispatch(ev)
    }
  }, [])

  // Greet on first open — pero NO si hay un pedido sin terminar para
  // retomar: antes esto disparaba igual a los 700ms sin mirar `resumable`,
  // sacando a ctx.state de "idle" (el único estado donde se muestra el
  // banner de "Retomar") y dejándolo invisible para siempre salvo que el
  // cliente lo viera en esa ventana de menos de un segundo. Bug real: un
  // cliente que volvía confundido tras un checkout interrumpido nunca veía
  // la opción de retomar y terminaba reservando todo de cero (ver incidente
  // Lucas López, reserva duplicada 05/08/2026).
  useEffect(() => {
    if (open && !greeted.current && ctx.state === "idle" && !resumable) {
      greeted.current = true
      setTyping(true)
      const t = setTimeout(() => {
        rawDispatch({ type: "OPEN" })
        setTyping(false)
      }, typingDelay(GREETING_DELAY_MS))
      return () => clearTimeout(t)
    }
  }, [open, ctx.state, resumable])

  // Persist draft
  useEffect(() => {
    if (ctx.state !== "idle" && ctx.state !== "confirmed" && ctx.state !== "error") {
      saveDraft(ctx.draft, ctx.state)
    }
    if (ctx.state === "confirmed") {
      clearDraft()
      setResumable(null)
      clearTurnoSelFired()
      clearFiredOnceInSession()
      // "Schedule" = el turno quedó reservado de verdad (reserva confirmada,
      // comprobante subido / MP aprobado). Esta SÍ va cliente-side +
      // server-side (a diferencia de Purchase): no tiene el problema de la
      // ventana de dedup de 48hs porque se dispara justo cuando el cliente
      // termina, no días después. Una sola vez por sesión.
      if (!scheduleFired.current) {
        scheduleFired.current = true
        const pp = packEventParams(ctx.draft.pack)
        const ppValue = typeof pp.value === "number" ? pp.value : undefined
        trackServerBackedEvent(
          "Schedule",
          { whatsapp: ctx.draft.whatsapp, nombre: ctx.draft.nombre },
          {
            ...pp,
            // draft.monto es el precio exacto que vio y aceptó el cliente,
            // guardado con el draft — más confiable que el precio "actual"
            // (que en el regreso de Mercado Pago puede no haberse cargado
            // todavía desde la config del sitio).
            value: ctx.draft.monto ?? ppValue ?? 0,
            currency: "ARS",
          },
        )
      }
      // El evento de Compra para Meta Ads NUNCA se manda desde acá — se
      // manda 100% server-side: mp-webhook.mts para Mercado Pago (al
      // confirmarse el pago), capi-confirmar-pago.mts para
      // transferencia/binance (cuando el admin revisa el comprobante y
      // aprieta "Confirmar pago"). Se probó disparar el píxel del navegador
      // acá + deduplicar por event_id contra el evento del servidor, pero la
      // ventana de deduplicación de Meta es de 48hs — el admin puede tardar
      // más que eso en confirmar un comprobante, y ahí Meta contaría la
      // misma venta dos veces en vez de fusionarla. Un solo origen de verdad
      // (servidor, disparado recién cuando la venta está confirmada de
      // verdad) evita ese problema de raíz.
    }
  }, [ctx.state, ctx.draft])

  // Detecta el regreso desde el checkout de Mercado Pago (?mp=success|pending|failure&ref=...)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const mp = params.get("mp")
    if (!mp) return
    const ref = params.get("ref")
    // Limpiamos la URL para que un refresh no vuelva a disparar esto
    window.history.replaceState(null, "", window.location.pathname)

    const stored = loadDraft()
    if (!stored || !stored.draft.idempotencyKey || stored.draft.idempotencyKey !== ref) return

    clearDraft()
    setResumable(null)
    rawDispatch({
      type: "MP_RETURN",
      status: mp === "success" ? "success" : mp === "pending" ? "pending" : "failure",
      draft: stored.draft,
    })
    setOpen(true)
    setForceExpanded(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const resumeDraft = useCallback(() => {
    const stored = loadDraft()
    if (!stored || !canResume(stored.state)) return
    rawDispatch({ type: "HYDRATE", draft: stored.draft, state: stored.state })
    setResumable(null)
    setOpen(true)
    greeted.current = true
  }, [])

  const discardDraft = useCallback(() => {
    clearDraft()
    setResumable(null)
    // RESET ya inserta el saludo directamente (ver reducer) sin pasar por
    // el efecto de arriba — marcar `greeted` acá evita que ese efecto
    // dispare un segundo saludo duplicado ahora que `resumable` pasó a null.
    greeted.current = true
    rawDispatch({ type: "RESET" })
  }, [])

  // Si hay draft pendiente, al abrir greet con el banner; manejamos en UI, acá solo exponemos.
  useEffect(() => {
    // Ensure greeting was injected even if we didn't go through OPEN (e.g. hydrate path)
    if (open && ctx.messages.length === 0 && ctx.state === "idle") {
      // nothing — greet handled in other effect
    }
  }, [open, ctx.messages.length, ctx.state])

  return {
    ctx: { ...ctx, mode: forceExpanded && ctx.state !== "idle" ? "expanded" : ctx.mode },
    dispatch,
    typing,
    resumable,
    resumeDraft,
    discardDraft,
    open,
    setOpen,
    forceExpanded,
    setForceExpanded,
  }
}

export { GREETING, isExpanded }
