import { createContext, useContext } from "react"
import { getAdminToken } from "../../lib/storage"

// Carteles del control de transferencias (ver transfer-check.mts). Solo
// informan: no cambian la reserva ni le avisan nada a Meta.

export type TransferStatus = {
  verdicts: Record<string, string>
  repeats: string[]
}

export const EMPTY_TRANSFER_STATUS: TransferStatus = { verdicts: {}, repeats: [] }

export const TransferStatusContext = createContext<TransferStatus>(EMPTY_TRANSFER_STATUS)

export async function fetchTransferStatus(): Promise<TransferStatus> {
  const token = getAdminToken()
  if (!token) return EMPTY_TRANSFER_STATUS
  try {
    const res = await fetch(`/api/transfer-status?token=${encodeURIComponent(token)}`)
    if (!res.ok) return EMPTY_TRANSFER_STATUS
    const data = (await res.json()) as Partial<TransferStatus>
    return { verdicts: data.verdicts ?? {}, repeats: data.repeats ?? [] }
  } catch {
    return EMPTY_TRANSFER_STATUS
  }
}

const PILL = "inline-block px-2 py-0.5 rounded-full text-[10px] font-mono uppercase whitespace-nowrap border"

export default function TransferBadge({ orderKey }: { orderKey?: string }) {
  const { verdicts, repeats } = useContext(TransferStatusContext)
  if (!orderKey) return null
  const verdict = verdicts[orderKey]
  const repeated = repeats.includes(orderKey)
  if (!verdict && !repeated) return null
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {verdict === "sospechosa" && (
        <span className={`${PILL} bg-red-500/20 text-red-300 border-red-500/40`}>⚠️ Sospechosa</span>
      )}
      {repeated && (
        <span className={`${PILL} bg-orange-500/20 text-orange-300 border-orange-500/40`}>
          🔁 Repetido
        </span>
      )}
      {verdict === "ok" && (
        <span className={`${PILL} bg-green-500/20 text-green-300 border-green-500/40`}>
          ✅ Pago encontrado
        </span>
      )}
    </span>
  )
}
