import { useCallback, useRef } from "react"
import { submitOrder } from "../lib/appsScript"
import { uploadComprobante } from "../lib/comprobante"
import type { FlowEvent, OrderDraft } from "../types/order"
import { randomId } from "../lib/crypto"
import { canSubmit, markSubmitted } from "../lib/storage"

type Return = {
  submit: (draft: OrderDraft) => Promise<void>
}

export function useOrderSubmit(dispatch: (ev: FlowEvent) => void): Return {
  const idempotencyRef = useRef<string>("")
  // Sobrevive a que el chat se cierre/reabra (FlowRenderer se desmonta y
  // vuelve a montar, pero este hook vive en ChatBot.tsx, que no). Sin esto,
  // reabrir el chat mientras un envío sigue en curso dispara un segundo
  // submit real y le muestra al cliente un error de "cooldown" aunque el
  // primer envío termine bien poco después.
  const inFlightRef = useRef(false)

  const submit = useCallback(
    async (draft: OrderDraft) => {
      if (inFlightRef.current) return
      if (!canSubmit()) {
        dispatch({ type: "SUBMIT_ERR", error: "cooldown" })
        return
      }
      if (!idempotencyRef.current) {
        idempotencyRef.current = draft.idempotencyKey || randomId()
      }
      const key = idempotencyRef.current

      inFlightRef.current = true
      dispatch({ type: "SUBMIT_START" })
      markSubmitted()

      const result = await submitOrder(draft, key)
      inFlightRef.current = false
      if (result.ok) {
        if (draft.file) {
          // Fire-and-forget: no bloquea la confirmación al cliente.
          uploadComprobante(key, draft.file)
        }
        dispatch({ type: "SUBMIT_OK", fileUrl: result.fileUrl || "" })
        idempotencyRef.current = ""
      } else {
        dispatch({ type: "SUBMIT_ERR", error: result.error })
      }
    },
    [dispatch],
  )

  return { submit }
}
