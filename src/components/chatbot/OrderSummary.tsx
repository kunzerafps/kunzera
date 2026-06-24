import { motion } from "framer-motion"
import { ArrowLeft, Check } from "lucide-react"
import type { OrderDraft } from "../../types/order"
import { PACKS } from "../../lib/packs"
import { formatARS, formatSlotLabel } from "../../lib/formatters"
import { useSiteConfig } from "../../hooks/useWaMessages"

type Props = {
  draft: OrderDraft
  onConfirm: () => void
  onBack: () => void
}

export default function OrderSummary({ draft, onConfirm, onBack }: Props) {
  const { prices } = useSiteConfig()
  const pack = draft.pack ? PACKS[draft.pack] : null
  if (!pack || !draft.turno) return null
  const ars = draft.pack ? prices[draft.pack].ars : pack.price

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-2 rounded-2xl border border-brand-900/60 bg-gradient-to-br from-brand-950/60 to-black/40 p-4"
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-2xl">{pack.emoji}</span>
        <div>
          <div className="font-display font-bold text-white">{pack.name}</div>
          <div className="text-xs text-white/50">{pack.tagline}</div>
        </div>
        <div className="ml-auto font-display font-black text-xl text-gradient-red">
          {formatARS(ars)}
        </div>
      </div>

      <div className="space-y-1.5 text-sm text-white/80 border-t border-white/5 pt-3">
        <Row label="Nombre" value={draft.nombre || "-"} />
        <Row label="WhatsApp" value={draft.whatsapp || "-"} />
        <Row label="Discord" value={draft.discord || "-"} />
        <Row label="Turno" value={formatSlotLabel(draft.turno)} highlight />
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={onBack}
          className="px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-sm flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Cambiar
        </button>
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={onConfirm}
          className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 hover:from-brand-400 hover:to-brand-600 text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-glow-red"
        >
          <Check className="w-4 h-4" /> Confirmar y pagar
        </motion.button>
      </div>
    </motion.div>
  )
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-white/40 text-xs font-mono uppercase">{label}</span>
      <span
        className={
          highlight
            ? "font-display font-bold text-brand-300 text-right"
            : "text-white/90 text-right"
        }
      >
        {value}
      </span>
    </div>
  )
}
