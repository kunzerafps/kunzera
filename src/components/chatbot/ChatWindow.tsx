import { motion } from "framer-motion"
import { Bot, Maximize2, Minimize2, Send, Sparkles, X } from "lucide-react"
import { memo, useCallback, useEffect, useRef, useState } from "react"
import type { ChatMessage, FlowEvent } from "../../types/order"
import MessageBubble from "./MessageBubble"
import TypingBubble from "./TypingBubble"
import FlowRenderer from "./FlowRenderer"
import type { FlowContext } from "../../lib/chatFlow"
import type { OrderDraft } from "../../types/order"

type Props = {
  ctx: FlowContext
  dispatch: (ev: FlowEvent) => void
  typing: boolean
  onClose: () => void
  onToggleExpand: () => void
  expanded: boolean
  onSubmit: (draft: OrderDraft) => void
  resumable?: { state: FlowContext["state"]; draft: FlowContext["draft"] } | null
  onResume?: () => void
  onDiscard?: () => void
}

export default function ChatWindow({
  ctx,
  dispatch,
  typing,
  onClose,
  onToggleExpand,
  expanded,
  onSubmit,
  resumable,
  onResume,
  onDiscard,
}: Props) {
  const handleChip = useCallback(
    (payload: string, label: string) => {
      dispatch({ type: "SELECT_CHIP", payload, label })
    },
    [dispatch],
  )

  const handleFreeText = useCallback(
    (text: string) => {
      dispatch({ type: "FREE_TEXT", text })
    },
    [dispatch],
  )

  const showTextInput =
    ctx.state === "idle" ||
    ctx.state === "greeting" ||
    ctx.state === "exploring" ||
    ctx.state === "planPicked"

  return (
    <>
      <ChatHeader onClose={onClose} onToggleExpand={onToggleExpand} expanded={expanded} />

      {resumable && ctx.state === "idle" && (
        <ResumeBanner onResume={onResume} onDiscard={onDiscard} />
      )}

      <MessagesList
        messages={ctx.messages}
        typing={typing}
        onChip={handleChip}
        flowSlot={<FlowRenderer ctx={ctx} dispatch={dispatch} onSubmit={onSubmit} />}
        bumpKey={ctx.state}
      />

      {showTextInput ? (
        <ChatInput onSend={handleFreeText} />
      ) : (
        <div className="p-3 border-t border-brand-900/60 bg-black/40 flex-shrink-0 flex items-center justify-between gap-3">
          <span className="text-[11px] text-white/40 font-mono">
            Seguí el flujo arriba ↑
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 border border-white/10 hover:border-red-500/40 text-white/70 hover:text-white text-xs font-semibold transition flex items-center gap-1.5"
          >
            <X className="w-3 h-3" /> Cerrar chat
          </button>
        </div>
      )}

    </>
  )
}

// ─────────────────────────────── Subcomponentes ──────────────────────────────

const ChatHeader = memo(function ChatHeader({
  onClose,
  onToggleExpand,
  expanded,
}: {
  onClose: () => void
  onToggleExpand: () => void
  expanded: boolean
}) {
  return (
    <div className="relative p-4 pb-3 bg-gradient-to-br from-brand-700 via-brand-800 to-brand-950 overflow-hidden flex-shrink-0">
      <div
        className="absolute inset-0 bg-grid-red opacity-30 pointer-events-none"
        style={{ backgroundSize: "20px 20px" }}
      />
      <div className="relative flex items-center gap-3">
        <div className="relative">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-white/20 to-white/5 border border-white/20 flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-400 border-2 border-brand-900" />
        </div>
        <div className="flex-1">
          <div className="font-display font-bold text-white flex items-center gap-1.5">
            Kunzera Bot
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
          </div>
          <div className="text-[11px] text-white/70 font-mono flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            En línea · responde al instante
          </div>
        </div>
        <button
          onClick={onToggleExpand}
          className="w-9 h-9 rounded-full hover:bg-white/15 bg-white/5 border border-white/10 flex items-center justify-center transition hidden sm:flex"
          aria-label={expanded ? "Minimizar" : "Maximizar"}
          title={expanded ? "Minimizar" : "Maximizar"}
        >
          {expanded ? (
            <Minimize2 className="w-4 h-4 text-white" />
          ) : (
            <Maximize2 className="w-4 h-4 text-white" />
          )}
        </button>
        <button
          onClick={onClose}
          className={`rounded-full hover:bg-red-500/30 bg-white/10 border border-white/20 hover:border-red-500/60 flex items-center justify-center transition font-semibold ${
            expanded
              ? "h-9 px-3 gap-1.5 text-xs text-white"
              : "w-9 h-9"
          }`}
          aria-label="Cerrar chat"
          title="Cerrar chat (ESC)"
          type="button"
        >
          <X className="w-4 h-4 text-white" />
          {expanded && <span>Cerrar</span>}
        </button>
      </div>
    </div>
  )
})

const ResumeBanner = memo(function ResumeBanner({
  onResume,
  onDiscard,
}: {
  onResume?: () => void
  onDiscard?: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-2 px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20 text-xs"
    >
      <span className="text-amber-200 flex-1">
        Tenés un pedido sin terminar.{" "}
        <span className="font-semibold">¿Retomarlo?</span>
      </span>
      <button
        onClick={onResume}
        className="px-3 py-1 rounded-full bg-amber-400 text-black font-semibold hover:bg-amber-300 transition"
      >
        Retomar
      </button>
      <button
        onClick={onDiscard}
        className="px-2 py-1 rounded-full text-amber-200 hover:bg-amber-500/20 transition"
      >
        Descartar
      </button>
    </motion.div>
  )
})

type MessagesListProps = {
  messages: ChatMessage[]
  typing: boolean
  onChip: (payload: string, label: string) => void
  flowSlot: React.ReactNode
  bumpKey: string
}

const MessagesList = memo(function MessagesList({
  messages,
  typing,
  onChip,
  flowSlot,
  bumpKey: _bumpKey,
}: MessagesListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // scroll auto (no smooth) para no bloquear paint frames
    el.scrollTop = el.scrollHeight
  }, [messages.length, typing])

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#08090a]"
      style={{ scrollbarWidth: "thin", overscrollBehavior: "contain" }}
      role="log"
      aria-live="polite"
    >
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} onChip={onChip} />
      ))}
      {typing && <TypingBubble />}
      {flowSlot}
    </div>
  )
})

// Input con state LOCAL. Escribir acá NO re-renderiza la lista de mensajes.
const ChatInput = memo(function ChatInput({ onSend }: { onSend: (text: string) => void }) {
  const [value, setValue] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const text = value.trim()
    if (!text) return
    onSend(text)
    setValue("")
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="p-3 border-t border-brand-900/60 bg-black/40 flex items-center gap-2 flex-shrink-0"
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Escribí tu mensaje…"
        className="flex-1 bg-white/5 border border-white/10 focus:border-brand-500/60 focus:bg-white/10 outline-none rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/30 transition"
      />
      <button
        type="submit"
        disabled={!value.trim()}
        aria-label="Enviar"
        className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-800 disabled:opacity-40 disabled:cursor-not-allowed hover:scale-105 transition flex items-center justify-center shadow-glow-red"
      >
        <Send className="w-4 h-4 text-white" />
      </button>
      {/* Honeypot oculto */}
      <input
        type="text"
        name="email"
        tabIndex={-1}
        autoComplete="off"
        className="absolute opacity-0 pointer-events-none"
        style={{ left: "-9999px", top: "-9999px", width: 1, height: 1 }}
      />
    </form>
  )
})
