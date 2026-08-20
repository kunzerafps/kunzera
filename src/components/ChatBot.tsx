import { AnimatePresence, motion } from "framer-motion"
import { Bot, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import ChatContainer from "./chatbot/ChatContainer"
import ChatWindow from "./chatbot/ChatWindow"
import { useChatFlow } from "../hooks/useChatFlow"
import { useOrderSubmit } from "../hooks/useOrderSubmit"
import { isExpanded } from "../lib/chatFlow"
import { listenOpenChat, type OpenChatDetail } from "../lib/chatBus"
import { PACKS } from "../lib/packs"

export default function ChatBot() {
  const flow = useChatFlow()
  const { submit } = useOrderSubmit(flow.dispatch)
  const [unread, setUnread] = useState(1)
  const pendingIntent = useRef<OpenChatDetail | null>(null)

  useEffect(() => {
    if (flow.open) setUnread(0)
  }, [flow.open])

  // Escucha eventos externos ("Reservar" desde Navbar/Hero/Pricing/CTA)
  useEffect(() => {
    const off = listenOpenChat((detail) => {
      pendingIntent.current = detail
      flow.setOpen(true)
    })
    return off
  }, [flow.setOpen])

  // Cuando el greeting ya se procesó, dispara la intención guardada
  useEffect(() => {
    const intent = pendingIntent.current
    if (!intent) return
    if (flow.ctx.state !== "greeting" && flow.ctx.state !== "exploring") return
    pendingIntent.current = null
    const timer = setTimeout(() => {
      if (intent.pack) {
        const packInfo = PACKS[intent.pack]
        flow.dispatch({
          type: "SELECT_CHIP",
          payload: intent.pack,
          label: `Quiero ${packInfo.name}`,
        })
      } else if (intent.startReservation) {
        flow.dispatch({ type: "SELECT_CHIP", payload: "reservar", label: "Reservar turno" })
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [flow.ctx.state, flow.dispatch])

  const mode = flow.forceExpanded
    ? "expanded"
    : isExpanded(flow.ctx.state)
    ? "expanded"
    : "compact"

  const handleToggleExpand = () => {
    if (mode === "expanded") {
      flow.setForceExpanded(false)
    } else {
      flow.setForceExpanded(true)
    }
  }

  const handleClose = () => {
    flow.setOpen(false)
    flow.setForceExpanded(false)
  }

  // Tecla ESC cierra el chat cuando está abierto
  useEffect(() => {
    if (!flow.open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        flow.setOpen(false)
        flow.setForceExpanded(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [flow.open, flow.setOpen, flow.setForceExpanded])

  return (
    <>
      {/* Launcher button */}
      <motion.button
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 1.3, type: "spring", stiffness: 200 }}
        onClick={() => flow.setOpen(!flow.open)}
        aria-label={flow.open ? "Cerrar chat" : "Abrir chat"}
        className={`fixed bottom-6 right-6 z-[60] group ${
          flow.open ? "hidden sm:block" : "block"
        }`}
      >
        <div className="launcher-pulse">
          <div className="relative w-14 h-14 rounded-full bg-gradient-to-br from-brand-500 to-brand-800 flex items-center justify-center shadow-2xl shadow-brand-900/60 hover:scale-110 transition overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent" />
            <AnimatePresence mode="wait" initial={false}>
              {flow.open ? (
                <motion.div
                  key="x"
                  initial={{ rotate: -90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: 90, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <X className="w-6 h-6 text-white" />
                </motion.div>
              ) : (
                <motion.div
                  key="bot"
                  initial={{ rotate: 90, opacity: 0 }}
                  animate={{ rotate: 0, opacity: 1 }}
                  exit={{ rotate: -90, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <Bot className="w-7 h-7 text-white" />
                </motion.div>
              )}
            </AnimatePresence>
            {unread > 0 && !flow.open && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white text-brand-700 text-[11px] font-bold flex items-center justify-center border-2 border-[#08090a]"
              >
                {unread}
              </motion.span>
            )}
          </div>
        </div>
      </motion.button>

      <ChatContainer
        open={flow.open}
        mode={mode}
        onBackdropClick={handleClose}
      >
        <ChatWindow
          ctx={flow.ctx}
          dispatch={flow.dispatch}
          typing={flow.typing}
          onClose={handleClose}
          onToggleExpand={handleToggleExpand}
          expanded={mode === "expanded"}
          onSubmit={submit}
          resumable={flow.resumable}
          onResume={flow.resumeDraft}
          onDiscard={flow.discardDraft}
        />
      </ChatContainer>
    </>
  )
}
