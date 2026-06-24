import { useCallback, useRef } from "react"
import { submitOrder } from "../lib/appsScript"
import type { FlowEvent, OrderDraft } from "../types/order"
import { randomId } from "../lib/crypto"
import { canSubmit, markSubmitted } from "../lib/storage"

type Return = {
  submit: (draft: OrderDraft) => Promise<void>
}

export function useOrderSubmit(dispatch: (ev: FlowEvent) => void): Return {
  const idempotencyRef = useRef<string>("")

  const submit = useCallback(
    async (draft: OrderDraft) => {
      if (!canSubmit()) {
        dispatch({ type: "SUBMIT_ERR", error: "cooldown" })
        return
      }
      if (!idempotencyRef.current) {
        idempotencyRef.current = draft.idempotencyKey || randomId()
      }

      dispatch({ type: "SUBMIT_START" })
      markSubmitted()

      const result = await submitOrder(draft, idempotencyRef.current)
      if (result.ok) {
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
