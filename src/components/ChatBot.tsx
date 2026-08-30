import { AnimatePresence, motion } from "framer-motion"
import { Bot, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import ChatContainer from "./chatbot/ChatContainer"
import ChatWindow from "./chatbot/ChatWindow"
import { useChatFlow } from "../hooks/useChatFlow"
import { useOrderSubmit } from "../hooks/useOrderSubmit"
import { isExpanded } from "../lib/chatFlow"
import { emitChatProgress, listenOpenChat, type OpenChatDetail } from "../lib/chatBus"
import { PACKS } from "../lib/packs"
import { trackServerBackedEvent } from "../lib/pixel"
import { trackContactOnce } from "../lib/contactEvent"
import { packEventParams } from "../lib/prices"
import { addToCartFiredForPack, markAddToCartFiredForPack } from "../lib/storage"

export default function ChatBot() {
  const flow = useChatFlow()
  const { submit } = useOrderSubmit(flow.dispatch)
  const [unread, setUnread] = useState(1)
  const pendingIntent = useRef<OpenChatDetail | null>(null)
  const contactFired = useRef(false)
  // El chat se abrió solo por un deep-link de anuncio (/reservar, ?pack=…),
  // no por un clic de la persona. En ese caso NO se manda el pixel "Contact":
  // contarlo sin interacción real infla el evento en todo el tráfico pago y
  // Meta deja de poder distinguir quién se enganchó de verdad.
  const autoOpened = useRef(false)

  useEffect(() => {
    if (flow.open) setUnread(0)
  }, [flow.open])

  // Avisa al botón flotante de WhatsApp que se esconda cuando la persona ya se
  // comprometió con una reserva (eligió un pack o entró al formulario) — no
  // queremos desviar a alguien que está por comprar. En "greeting"/"exploring"
  // sigue visible: ahí todavía puede tener una duda que lo frene.
  useEffect(() => {
    emitChatProgress(flow.open && (flow.ctx.state === "planPicked" || isExpanded(flow.ctx.state)))
  }, [flow.open, flow.ctx.state])

  // AddToCart ("eligió un pack"), disparador ÚNICO para los cuatro caminos.
  //
  // Antes vivía en el handler del chip del chat (ChatWindow), así que solo
  // contaba a quien tocaba el globito adentro del chat. El botón "Reservar
  // Platino/Diamante" de la sección de precios y los deep-links de anuncios
  // (/reservar/<pack>, ?pack=) despachan SELECT_CHIP directo desde acá abajo,
  // salteándolo — justo el tráfico pago con más intención. En los datos de
  // Meta eso se veía como más InitiateCheckout que AddToCart, que en un
  // embudo real es imposible.
  //
  // Mirando `draft.pack` se cubren los cuatro caminos con un solo punto,
  // porque todos terminan pasando por el reducer. El guard vive en
  // sessionStorage y guarda QUÉ pack se mandó: si la persona compara los dos
  // y cambia, sale de nuevo con el pack y el precio correctos (antes quedaba
  // pegado al primero).
  useEffect(() => {
    const pack = flow.ctx.draft.pack
    if (!pack) return
    if (addToCartFiredForPack() === pack) return
    markAddToCartFiredForPack(pack)
    trackServerBackedEvent("AddToCart", undefined, packEventParams(pack))
  }, [flow.ctx.draft.pack])

  // Contact: señal de "abrió el chat de reserva", sin importar si entró por
  // el botón "Reservar" (Navbar/Hero/Pricing/CTA, vía chatBus) o tocando
  // directo el ícono flotante.
  //
  // El tope ahora es COMPARTIDO con los otros tres botones de WhatsApp (ver
  // contactEvent.ts) y vive en sessionStorage, no en este ref: antes cada
  // sitio contaba por su lado y una misma persona podía generar 3 o 4
  // Contact en la misma visita (abrir el chat + tocar el flotante + el del
  // pie). El ref se conserva igual para no reintentar en cada render.
  useEffect(() => {
    if (flow.open && !contactFired.current && !autoOpened.current) {
      contactFired.current = true
      const pack = pendingIntent.current?.pack
      trackContactOnce(pack ? PACKS[pack].name : "chat_bot", {
        whatsapp: flow.ctx.draft.whatsapp,
        nombre: flow.ctx.draft.nombre,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.open])

  // Escucha eventos externos ("Reservar" desde Navbar/Hero/Pricing/CTA, y los
  // deep-links de anuncios vía deeplink.ts)
  useEffect(() => {
    const off = listenOpenChat((detail) => {
      pendingIntent.current = detail
      if (detail.auto) autoOpened.current = true
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

  // "Descartar" un pedido = arrancar limpio: también se olvida cualquier
  // intención de deep-link/anuncio pendiente, para no auto-seleccionar un pack
  // justo después de que la persona pidió empezar de cero.
  const handleDiscard = () => {
    pendingIntent.current = null
    flow.discardDraft()
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
        className={`fixed bottom-20 right-6 z-[60] group md:bottom-6 ${
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
          onDiscard={handleDiscard}
        />
      </ChatContainer>
    </>
  )
}
