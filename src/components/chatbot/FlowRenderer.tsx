import { useEffect } from "react"
import type { FlowEvent, OrderDraft } from "../../types/order"
import type { FlowContext } from "../../lib/chatFlow"
import FormField from "./FormField"
import SlotPicker from "./SlotPicker"
import OrderSummary from "./OrderSummary"
import PaymentStep from "./PaymentStep"
import FileUploader from "./FileUploader"
import {
  normalizeEmail,
  normalizeWhatsapp,
  validateDiscord,
  validateEmail,
  validateName,
  validateWhatsapp,
} from "../../lib/validators"
import { useTakenSlots } from "../../hooks/useTakenSlots"
import { trackServerBackedEvent } from "../../lib/pixel"
import { packEventParams } from "../../lib/prices"
import {
  firedOnceInSession,
  markFiredOnceInSession,
  markTurnoSelFired,
  turnoSelAlreadyFired,
} from "../../lib/storage"

type Props = {
  ctx: FlowContext
  dispatch: (ev: FlowEvent) => void
  onSubmit: (draft: OrderDraft) => void
}

export default function FlowRenderer({ ctx, dispatch, onSubmit }: Props) {
  const slotsState = useTakenSlots(ctx.state === "pickSlot")

  useEffect(() => {
    if (ctx.state === "submitting" && ctx.draft.file) {
      onSubmit(ctx.draft)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.state])

  switch (ctx.state) {
    case "askName":
      return (
        <FormField
          key="askName"
          label="Nombre y apellido"
          placeholder="Juan Pérez"
          autoComplete="name"
          initialValue={ctx.draft.nombre || ""}
          onSubmit={(v) => {
            const err = validateName(v)
            if (err) return err
            dispatch({ type: "SET_NAME", value: v.trim() })
            return null
          }}
        />
      )

    case "askWhatsapp":
      return (
        <FormField
          key="askWhatsapp"
          label="WhatsApp (sin 54 9)"
          placeholder="3382677871"
          type="tel"
          autoComplete="tel"
          initialValue={ctx.draft.whatsapp || ""}
          onSubmit={(v) => {
            const err = validateWhatsapp(v)
            if (err) return err
            const whatsapp = normalizeWhatsapp(v)
            // Lead: la señal más fuerte de "interés real" del embudo. Se
            // manda por el píxel Y por el servidor (con teléfono/nombre
            // hasheados, que ya tenemos acá) — ver trackServerBackedEvent.
            // Lleva el precio del pack como `value` para que Meta pueda
            // optimizar por plata en este paso, no solo por "dejó los datos".
            // Una sola vez por sesión: si vuelve atrás y reescribe el
            // teléfono no se cuenta de nuevo.
            if (!firedOnceInSession("lead")) {
              markFiredOnceInSession("lead")
              trackServerBackedEvent(
                "Lead",
                { whatsapp, nombre: ctx.draft.nombre },
                packEventParams(ctx.draft.pack),
              )
            }
            dispatch({ type: "SET_WHATSAPP", value: whatsapp })
            return null
          }}
        />
      )

    // Paso opcional. El mail es la señal que más sube la precisión con la que
    // Meta reconoce al comprador, y hoy solo llega en el 40% de las compras
    // (Mercado Pago lo trae solo, las ventas manuales lo piden; transferencia
    // y Binance —la mayoría— no lo pedían nunca).
    //
    // OJO: este mail NO viaja al Apps Script. El campo `email` de ese payload
    // es un honeypot anti-spam (Code.gs:108 rechaza la reserva entera con
    // "spam_detected" si viene con algo). Va al servidor por
    // capture-attribution y lo lee capi-confirmar-pago para el evento de
    // Compra.
    case "askEmail":
      return (
        <FormField
          key="askEmail"
          label="Mail (opcional)"
          placeholder="juan@gmail.com"
          type="email"
          autoComplete="email"
          initialValue={ctx.draft.email || ""}
          skipLabel="Prefiero no dejarlo"
          onSkip={() => dispatch({ type: "SKIP_EMAIL" })}
          onSubmit={(v) => {
            const err = validateEmail(v)
            if (err) return err
            dispatch({ type: "SET_EMAIL", value: normalizeEmail(v) })
            return null
          }}
        />
      )

    case "askDiscord":
      return (
        <FormField
          key="askDiscord"
          label="Usuario de Discord"
          placeholder="tunombre o tunombre#1234"
          initialValue={ctx.draft.discord || ""}
          onSubmit={(v) => {
            const err = validateDiscord(v)
            if (err) return err
            dispatch({ type: "SET_DISCORD", value: v.trim() })
            return null
          }}
        />
      )

    case "pickSlot":
      return (
        <SlotPicker
          slots={slotsState.slots}
          loading={slotsState.loading}
          error={slotsState.error}
          onPick={(iso) => {
            // Señal temprana de intención (tocó un horario), NO es "reservó"
            // — ese es el evento Schedule que se manda al confirmar la
            // reserva (ver useChatFlow.ts). Una vez por sesión de navegador.
            // Para llegar acá ya pasó por askName + askWhatsapp, así que la
            // copia server-side lleva teléfono/nombre hasheados (igual que
            // Lead y Schedule) — antes iba anónima.
            if (!turnoSelAlreadyFired()) {
              markTurnoSelFired()
              trackServerBackedEvent(
                "turno_seleccionado",
                { whatsapp: ctx.draft.whatsapp, nombre: ctx.draft.nombre },
                packEventParams(ctx.draft.pack),
              )
            }
            dispatch({ type: "PICK_SLOT", slotIso: iso })
          }}
          onRefresh={slotsState.refresh}
        />
      )

    case "review":
      return (
        <OrderSummary
          draft={ctx.draft}
          onConfirm={() => dispatch({ type: "CONFIRM_REVIEW" })}
          onBack={() => dispatch({ type: "BACK" })}
        />
      )

    case "payment":
      return (
        <PaymentStep
          draft={ctx.draft}
          onPaid={() => dispatch({ type: "CONFIRM_PAYMENT" })}
          onBack={() => dispatch({ type: "BACK" })}
          onKeyReady={(key) => dispatch({ type: "SET_ORDER_KEY", key })}
        />
      )

    case "uploadProof":
      return (
        <FileUploader
          onFile={(file) => dispatch({ type: "UPLOAD_FILE", file })}
        />
      )

    default:
      return null
  }
}
