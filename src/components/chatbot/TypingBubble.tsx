import { motion } from "framer-motion"
import { Zap } from "lucide-react"
import { memo } from "react"

function TypingBubbleImpl() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex gap-2 justify-start"
    >
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-brand-600 to-brand-900 flex items-center justify-center">
        <Zap className="w-3.5 h-3.5 text-white" fill="currentColor" />
      </div>
      <div className="px-4 py-3 rounded-2xl rounded-bl-sm bg-white/5 border border-white/10 flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            animate={{ y: [0, -4, 0], opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
            className="w-1.5 h-1.5 rounded-full bg-brand-400"
          />
        ))}
      </div>
    </motion.div>
  )
}

export default memo(TypingBubbleImpl)
