import { motion } from "framer-motion"
import { Zap } from "lucide-react"
import { memo, type ReactNode } from "react"
import { SiWhatsapp } from "react-icons/si"
import type { ChatMessage } from "../../types/order"

type Props = {
  message: ChatMessage
  onChip: (payload: string, label: string) => void
  // Clic en el link "Ir a WhatsApp" de recuperación. Lo maneja ChatWindow,
  // que es quien tiene el draft con el nombre y el teléfono ya cargados —
  // acá el evento se mandaba anónimo (ver contactEvent.ts).
  onContactLink: () => void
}

// Mini-renderer de markdown inline: *bold*, `code`
function renderInlineMarkdown(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  const regex = /(\*[^*\n]+\*|`[^`\n]+`)/g
  let lastIndex = 0
  let key = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const token = match[0]
    if (token.startsWith("*")) {
      parts.push(
        <strong key={key++} className="font-semibold text-white">
          {token.slice(1, -1)}
        </strong>,
      )
    } else if (token.startsWith("`")) {
      parts.push(
        <code
          key={key++}
          className="bg-black/40 border border-white/10 px-1.5 py-0.5 rounded text-brand-300 font-mono text-[0.9em]"
        >
          {token.slice(1, -1)}
        </code>,
      )
    }
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}

function MessageBubbleImpl({ message, onChip, onContactLink }: Props) {
  const isBot = message.from === "bot"
  const variant = message.variant || "default"

  const bubbleClass = !isBot
    ? "bg-gradient-to-br from-brand-500 to-brand-700 text-white rounded-br-sm shadow-lg shadow-brand-900/50"
    : variant === "success"
    ? "bg-gradient-to-br from-green-500/20 to-green-700/20 border border-green-500/40 text-green-50 rounded-bl-sm shadow-lg shadow-green-900/30"
    : variant === "error"
    ? "bg-gradient-to-br from-red-500/20 to-red-700/20 border border-red-500/40 text-red-50 rounded-bl-sm shadow-lg shadow-red-900/30"
    : "bg-white/5 border border-white/10 text-white/90 rounded-bl-sm"

  const avatarClass =
    variant === "success"
      ? "bg-gradient-to-br from-green-500 to-green-700"
      : variant === "error"
      ? "bg-gradient-to-br from-red-500 to-red-800"
      : "bg-gradient-to-br from-brand-600 to-brand-900"

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex gap-2 ${isBot ? "justify-start" : "justify-end"}`}
    >
      {isBot && (
        <div
          className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-auto ${avatarClass}`}
        >
          <Zap className="w-3.5 h-3.5 text-white" fill="currentColor" />
        </div>
      )}

      <div className={`max-w-[78%] ${isBot ? "" : "items-end"}`}>
        <div
          className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-line ${bubbleClass}`}
        >
          {renderInlineMarkdown(message.text)}
        </div>

        {message.chips && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.chips.map((c) => (
              <motion.button
                key={c.payload + c.label}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => onChip(c.payload, c.label)}
                className="px-3 py-1.5 text-xs rounded-full bg-brand-950/80 border border-brand-700/50 hover:border-brand-500 hover:bg-brand-900 text-brand-200 transition"
              >
                {c.label}
              </motion.button>
            ))}
          </div>
        )}

        {message.link && (
          <a
            href={message.link.href}
            target="_blank"
            rel="noreferrer"
            onClick={onContactLink}
            className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-green-500 to-green-700 hover:from-green-400 hover:to-green-600 text-white text-sm font-semibold transition shadow-lg shadow-green-900/50"
          >
            <SiWhatsapp className="w-4 h-4" />
            {message.link.label}
          </a>
        )}
      </div>
    </motion.div>
  )
}

const MessageBubble = memo(MessageBubbleImpl, (prev, next) => prev.message === next.message)
export default MessageBubble
