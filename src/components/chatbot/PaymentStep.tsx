import { motion } from "framer-motion"
import { ArrowLeft, Check, Copy, CreditCard, Wallet } from "lucide-react"
import { useState } from "react"
import type { OrderDraft } from "../../types/order"
import { BINANCE_EMAIL, MP_ALIAS } from "../../lib/constants"
import { formatARS } from "../../lib/formatters"
import { useSiteConfig } from "../../hooks/useWaMessages"

type Props = {
  draft: OrderDraft
  onPaid: () => void
  onBack: () => void
}

type Method = "transferencia" | "binance"

const METHODS: {
  id: Method
  label: string
  icon: typeof CreditCard
  fieldLabel: string
  value: string
  helper: string
}[] = [
  {
    id: "transferencia",
    label: "Transferencia",
    icon: CreditCard,
    fieldLabel: "Alias Mercado Pago",
    value: MP_ALIAS,
    helper:
      "Transferí desde la app de Mercado Pago o tu banco al alias. Luego subí el comprobante para confirmar la reserva.",
  },
  {
    id: "binance",
    label: "Binance",
    icon: Wallet,
    fieldLabel: "Email Binance Pay (USDT)",
    value: BINANCE_EMAIL,
    helper:
      "Mandá el equivalente en USDT desde Binance Pay al email. Después subí el comprobante para confirmar la reserva.",
  },
]

export default function PaymentStep({ draft, onPaid, onBack }: Props) {
  const { prices } = useSiteConfig()
  const [method, setMethod] = useState<Method>("transferencia")
  const [copied, setCopied] = useState(false)

  const active = METHODS.find((m) => m.id === method)!
  const Icon = active.icon

  const ars = draft.pack ? prices[draft.pack].ars : draft.monto || 0
  const usd = draft.pack ? prices[draft.pack].usd : 0
  const displayAmount =
    method === "binance"
      ? `USD $${usd.toLocaleString("es-AR")}`
      : formatARS(ars)

  const copyValue = async () => {
    try {
      await navigator.clipboard.writeText(active.value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const el = document.createElement("textarea")
      el.value = active.value
      document.body.appendChild(el)
      el.select()
      try {
        document.execCommand("copy")
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        /* noop */
      }
      document.body.removeChild(el)
    }
  }

  const switchMethod = (next: Method) => {
    if (next === method) return
    setMethod(next)
    setCopied(false)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-2 rounded-2xl border border-brand-900/60 bg-gradient-to-br from-brand-950/60 to-black/40 p-4"
    >
      <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-brand-300 mb-3">
        <Icon className="w-3.5 h-3.5" /> Forma de pago
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-black/40 border border-brand-900/60 mb-4">
        {METHODS.map((m) => {
          const MIcon = m.icon
          const isActive = m.id === method
          return (
            <button
              key={m.id}
              onClick={() => switchMethod(m.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition ${
                isActive
                  ? "bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-glow-red"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
            >
              <MIcon className="w-3.5 h-3.5" />
              {m.label}
            </button>
          )
        })}
      </div>

      <div className="text-center mb-4">
        <div className="text-xs text-white/50">
          {method === "binance" ? "Monto a enviar (USDT)" : "Monto a transferir"}
        </div>
        <div className="font-display font-black text-3xl text-gradient-red">
          {displayAmount}
        </div>
      </div>

      <button
        onClick={copyValue}
        className="w-full group flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-black/40 border border-brand-700/50 hover:border-brand-500 transition"
      >
        <div className="text-left min-w-0">
          <div className="text-[10px] text-white/40 font-mono uppercase">
            {active.fieldLabel}
          </div>
          <div className="font-mono text-white text-base truncate">
            {active.value}
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-brand-300 group-hover:text-brand-200 font-mono uppercase shrink-0">
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5" /> Copiado
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" /> Copiar
            </>
          )}
        </div>
      </button>

      <p className="mt-3 text-xs text-white/50 leading-relaxed">{active.helper}</p>

      <div className="mt-4 flex gap-2">
        <button
          onClick={onBack}
          className="px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-sm flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Volver
        </button>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onPaid}
          className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-green-500 to-green-700 hover:from-green-400 hover:to-green-600 text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-lg shadow-green-900/40"
        >
          Ya pagué, subir comprobante
        </motion.button>
      </div>
    </motion.div>
  )
}
