import { motion } from "framer-motion"
import { ArrowLeft, Check, Copy, CreditCard, Landmark, Wallet } from "lucide-react"
import { useState } from "react"
import type { OrderDraft } from "../../types/order"
import { BINANCE_EMAIL, MP_ALIAS } from "../../lib/constants"
import { formatARS } from "../../lib/formatters"
import { useSiteConfig } from "../../hooks/useWaMessages"
import { submitOrder } from "../../lib/appsScript"
import { randomId } from "../../lib/crypto"
import { saveDraft } from "../../lib/storage"

type Props = {
  draft: OrderDraft
  onPaid: () => void
  onBack: () => void
}

type Method = "transferencia" | "binance" | "mercadopago"

const MP_FEE_RATE = 0.0777

const METHODS: {
  id: Method
  label: string
  icon: typeof CreditCard
}[] = [
  { id: "transferencia", label: "Transferencia", icon: CreditCard },
  { id: "binance", label: "Binance", icon: Wallet },
  { id: "mercadopago", label: "Mercado Pago", icon: Landmark },
]

const ALIAS_METHODS: Record<
  "transferencia" | "binance",
  { fieldLabel: string; value: string; helper: string }
> = {
  transferencia: {
    fieldLabel: "Alias Mercado Pago",
    value: MP_ALIAS,
    helper:
      "Transferí desde la app de Mercado Pago o tu banco al alias. Luego subí el comprobante para confirmar la reserva.",
  },
  binance: {
    fieldLabel: "Email Binance Pay (USDT)",
    value: BINANCE_EMAIL,
    helper:
      "Mandá el equivalente en USDT desde Binance Pay al email. Después subí el comprobante para confirmar la reserva.",
  },
}

export default function PaymentStep({ draft, onPaid, onBack }: Props) {
  const { prices } = useSiteConfig()
  const [method, setMethod] = useState<Method>("transferencia")
  const [copied, setCopied] = useState(false)
  const [mpLoading, setMpLoading] = useState(false)
  const [mpError, setMpError] = useState<string | null>(null)

  const active = method !== "mercadopago" ? ALIAS_METHODS[method] : null
  const Icon = METHODS.find((m) => m.id === method)!.icon

  const ars = draft.pack ? prices[draft.pack].ars : draft.monto || 0
  const usd = draft.pack ? prices[draft.pack].usd : 0
  const mpTotal = Math.ceil((ars * (1 + MP_FEE_RATE)) / 10) * 10
  const displayAmount =
    method === "binance"
      ? `USD $${usd.toLocaleString("es-AR")}`
      : method === "mercadopago"
      ? formatARS(mpTotal)
      : formatARS(ars)

  const copyValue = async () => {
    if (!active) return
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
    setMpError(null)
  }

  const payWithMercadoPago = async () => {
    setMpError(null)
    setMpLoading(true)

    const idempotencyKey = draft.idempotencyKey || randomId()
    const draftWithKey = { ...draft, idempotencyKey }

    const orderResult = await submitOrder(draftWithKey, idempotencyKey)
    if (!orderResult.ok) {
      setMpLoading(false)
      setMpError(
        orderResult.error === "slot_taken"
          ? "Ese turno se acaba de ocupar. Volvé atrás y elegí otro horario."
          : "No se pudo iniciar el pago. Intentá de nuevo en unos segundos.",
      )
      return
    }

    // Guardamos el draft con la key ANTES de salir de la página, así lo
    // recuperamos al volver del checkout de Mercado Pago.
    saveDraft(draftWithKey, "payment")

    try {
      const res = await fetch("/api/mp-create-preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pack: draft.pack,
          nombre: draft.nombre,
          idempotencyKey,
        }),
      })
      const data = await res.json()
      if (!data?.ok || !data.init_point) throw new Error("no_init_point")
      window.location.href = data.init_point
    } catch {
      setMpLoading(false)
      setMpError("No se pudo conectar con Mercado Pago. Intentá de nuevo.")
    }
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
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[11px] font-semibold transition ${
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
          {method === "binance"
            ? "Monto a enviar (USDT)"
            : method === "mercadopago"
            ? "Total a pagar (incluye comisión)"
            : "Monto a transferir"}
        </div>
        <div className="font-display font-black text-3xl text-gradient-red">
          {displayAmount}
        </div>
        {method === "mercadopago" && (
          <div className="text-[11px] text-white/40 mt-1">
            Precio base {formatARS(ars)} + comisión Mercado Pago
          </div>
        )}
      </div>

      {method === "mercadopago" ? (
        <>
          {mpError && (
            <p className="mb-3 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              {mpError}
            </p>
          )}
          <p className="text-xs text-white/50 leading-relaxed">
            Te vamos a redirigir a Mercado Pago para pagar con tarjeta o dinero en cuenta.
            La reserva se confirma automáticamente apenas se acredita el pago.
          </p>
        </>
      ) : (
        <>
          <button
            onClick={copyValue}
            className="w-full group flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-black/40 border border-brand-700/50 hover:border-brand-500 transition"
          >
            <div className="text-left min-w-0">
              <div className="text-[10px] text-white/40 font-mono uppercase">
                {active!.fieldLabel}
              </div>
              <div className="font-mono text-white text-base truncate">
                {active!.value}
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

          <p className="mt-3 text-xs text-white/50 leading-relaxed">{active!.helper}</p>
        </>
      )}

      <div className="mt-4 flex gap-2">
        <button
          onClick={onBack}
          className="px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-sm flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Volver
        </button>
        {method === "mercadopago" ? (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={payWithMercadoPago}
            disabled={mpLoading}
            className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-blue-700 hover:from-blue-400 hover:to-blue-600 disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-lg shadow-blue-900/40"
          >
            {mpLoading ? "Conectando…" : "Pagar con Mercado Pago"}
          </motion.button>
        ) : (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onPaid}
            className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-green-500 to-green-700 hover:from-green-400 hover:to-green-600 text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-lg shadow-green-900/40"
          >
            Ya pagué, subir comprobante
          </motion.button>
        )}
      </div>
    </motion.div>
  )
}
