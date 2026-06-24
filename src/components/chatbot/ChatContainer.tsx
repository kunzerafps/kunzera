import { motion } from "framer-motion"
import { useEffect, useState, type ReactNode } from "react"

type Props = {
  open: boolean
  mode: "compact" | "expanded"
  onBackdropClick?: () => void
  children: ReactNode
}

function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < breakpoint : false,
  )
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint)
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [breakpoint])
  return isMobile
}

export default function ChatContainer({ open, mode, onBackdropClick, children }: Props) {
  const isMobile = useIsMobile()
  if (!open) return null

  // 📱 MÓVIL: siempre full screen, sin importar el mode
  if (isMobile) {
    return (
      <motion.div
        key="chat-mobile"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="fixed inset-0 z-50 flex flex-col bg-[#0c0204]"
      >
        {children}
      </motion.div>
    )
  }

  // 💻 DESKTOP expandido: centrado con backdrop
  if (mode === "expanded") {
    return (
      <>
        <div
          className="fixed inset-0 z-40 bg-black/85 cursor-pointer"
          onClick={onBackdropClick}
          aria-hidden
        />
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none p-6">
          <motion.div
            key="chat-expanded"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-auto w-[min(92vw,48rem)] h-[min(88vh,720px)] flex flex-col rounded-2xl overflow-hidden shadow-2xl shadow-brand-950/70 border border-brand-900/60 bg-[#0c0204]"
          >
            {children}
          </motion.div>
        </div>
      </>
    )
  }

  // 💻 DESKTOP compact: esquina
  return (
    <motion.div
      key="chat-compact"
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="fixed bottom-24 right-6 z-50 flex flex-col rounded-2xl overflow-hidden shadow-2xl shadow-brand-950/70 border border-brand-900/60 bg-[#0c0204] w-[380px] max-h-[78vh]"
    >
      {children}
    </motion.div>
  )
}
