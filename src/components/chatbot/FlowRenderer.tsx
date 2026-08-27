import { useEffect } from "react"
import type { FlowEvent, OrderDraft } from "../../types/order"
import type { FlowContext } from "../../lib/chatFlow"
import FormField from "./FormField"
import SlotPicker from "./SlotPicker"
import OrderSummary from "./OrderSummary"
import PaymentStep from "./PaymentStep"
import FileUploader from "./FileUploader"
import { normalizeWhatsapp, validateDiscord, validateName, validateWhatsapp } from "../../lib/validators"
import { useTakenSlots } from "../../hooks/useTakenSlots"
import { trackPixelEvent, trackServerBackedEvent } from "../../lib/pixel"

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
            trackServerBackedEvent(
              "Lead",
              { whatsapp, nombre: ctx.draft.nombre },
              { content_name: ctx.draft.pack || "unknown" },
            )
            dispatch({ type: "SET_WHATSAPP", value: whatsapp })
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
            trackPixelEvent("Schedule", { content_name: ctx.draft.pack || "unknown" })
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
