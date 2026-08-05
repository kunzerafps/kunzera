import type {
  ChatMessage,
  FlowEvent,
  FlowState,
  OrderDraft,
  Pack,
} from "../types/order"
import { PACKS } from "./packs"
import { formatARS, formatSlotLabel } from "./formatters"
import { randomId } from "./crypto"
import { MP_ALIAS, waLink, WHATSAPP_MESSAGE_GENERAL } from "./constants"
import { getArs } from "./prices"

export type FlowContext = {
  state: FlowState
  messages: ChatMessage[]
  draft: OrderDraft
  error?: string
  mode: "compact" | "expanded"
  nextId: number
  stateAnchors: Partial<Record<FlowState, number>>
}

const EXPANDED_STATES: FlowState[] = [
  "askName",
  "askWhatsapp",
  "askDiscord",
  "pickSlot",
  "review",
  "payment",
  "uploadProof",
  "submitting",
  "confirmed",
  "error",
]

export function isExpanded(state: FlowState): boolean {
  return EXPANDED_STATES.includes(state)
}

export function initialContext(): FlowContext {
  return {
    state: "idle",
    messages: [],
    draft: {},
    mode: "compact",
    nextId: 1,
    stateAnchors: {},
  }
}

// ──────────────────────────── BOT MESSAGE FACTORIES ───────────────────────────

function bot(text: string, extras: Partial<ChatMessage> = {}): ChatMessage {
  return { id: 0, from: "bot", text, ...extras }
}

function user(text: string): ChatMessage {
  return { id: 0, from: "user", text }
}

export const GREETING: ChatMessage[] = [
  bot("¡Hola! 👋 Soy el asistente de Kunzera. ¿En qué te puedo ayudar?"),
  bot("Elegí una opción o escribime 👇", {
    chips: [
      { label: "Ver packs", payload: "packs" },
      { label: "¿Cómo funciona?", payload: "como" },
      { label: "¿Es seguro?", payload: "seguro" },
      { label: "Reservar turno", payload: "reservar" },
    ],
  }),
]

const BOT_INFO: Record<string, ChatMessage[]> = {
  packs: [
    bot(
      `Tenemos 2 packs:\n\n⚡ *Platino* — ${formatARS(getArs("platino"))}\n${PACKS.platino.tagline}\n\n💎 *Diamante* — ${formatARS(getArs("diamante"))}\n${PACKS.diamante.tagline}`,
      {
        chips: [
          { label: "Quiero Platino", payload: "platino" },
          { label: "Quiero Diamante", payload: "diamante" },
        ],
      },
    ),
  ],
  como: [
    bot(
      "El proceso es 100% remoto:\n\n1️⃣ Reservás tu turno acá\n2️⃣ Pagás por Mercado Pago\n3️⃣ Me conecto por Anydesk a tu PC\n4️⃣ Aplico +30 tweaks y testeamos\n\nNecesitás: Anydesk + Discord o WhatsApp.",
      {
        chips: [
          { label: "Reservar ahora", payload: "reservar" },
          { label: "¿Es seguro?", payload: "seguro" },
        ],
      },
    ),
  ],
  seguro: [
    bot(
      "Totalmente. Antes de tocar nada se crea un punto de restauración y backup del registro. Todo es reversible y probado en +6000 PCs. ✅",
      {
        chips: [
          { label: "Ver packs", payload: "packs" },
          { label: "Reservar", payload: "reservar" },
        ],
      },
    ),
  ],
}

function planPickedMessages(pack: Pack): ChatMessage[] {
  const p = PACKS[pack]
  return [
    bot(
      `${p.emoji} Elegiste el pack *${p.name}* (${formatARS(getArs(pack))}).\n¿Querés reservar tu turno ahora?`,
      {
        chips: [
          { label: "Sí, reservar", payload: "reservar" },
          { label: "Ver el otro pack", payload: "packs" },
        ],
      },
    ),
  ]
}

function askNameMessages(): ChatMessage[] {
  return [
    bot("Dale, empecemos. ¿Cuál es tu *nombre y apellido*?"),
  ]
}

function askWhatsappMessages(): ChatMessage[] {
  return [
    bot("Genial. ¿Cuál es tu número de *WhatsApp*?\nSolo el código de área + número, sin el 54 9 (ej: 3382677871)."),
  ]
}

function pickSlotMessages(): ChatMessage[] {
  return [
    bot("Elegí el día y horario que prefieras 👇"),
  ]
}

function reviewMessages(draft: OrderDraft): ChatMessage[] {
  return [
    bot(
      `Revisá tu pedido:\n\n${PACKS[draft.pack!].emoji} *${PACKS[draft.pack!].name}* — ${formatARS(draft.monto || 0)}\n👤 ${draft.nombre}\n📱 ${draft.whatsapp}\n📅 ${formatSlotLabel(draft.turno!)}\n\n¿Confirmás?`,
    ),
  ]
}

function paymentMessages(draft: OrderDraft): ChatMessage[] {
  return [
    bot(
      `Perfecto. Pagá *${formatARS(draft.monto || 0)}* por *transferencia* (alias \`${MP_ALIAS}\`) o por *Binance Pay* en USDT. Elegí abajo cuál usás 👇`,
    ),
  ]
}

function uploadProofMessages(): ChatMessage[] {
  return [
    bot("Subí una captura o PDF del comprobante (máx 6 MB) para confirmar la reserva."),
  ]
}

function submittingMessages(): ChatMessage[] {
  return [bot("Registrando tu reserva… ⏳")]
}

function confirmedMessages(draft: OrderDraft, _fileUrl: string): ChatMessage[] {
  return [
    bot(
      `¡Listo! 🎉 Tu turno quedó reservado para *${formatSlotLabel(draft.turno!)}*.\n\nTe escribo al WhatsApp 10 minutos antes de la hora pactada. Mientras tanto, descargá AnyDesk desde anydesk.com. Si tu pack incluye optimización de BIOS, también te voy a mandar un link de Google Meet para que puedas enfocarme el monitor y configurarla juntos.`,
      { variant: "success" },
    ),
  ]
}

// Mercado Pago puede volver con el pago en estado "pending" (revisión del
// medio de pago, no necesariamente un rechazo). Nada está reservado
// todavía — la reserva recién se crea cuando el webhook ve el pago
// aprobado — así que NO reutilizamos el mensaje de éxito acá.
function pendingMessages(draft: OrderDraft): ChatMessage[] {
  const waMsg =
    `Hola! Pagué el pack ${PACKS[draft.pack!]?.name || ""} con Mercado Pago y quedó "pendiente". ` +
    `Turno: ${draft.turno ? formatSlotLabel(draft.turno) : ""}. Nombre: ${draft.nombre || "-"}.`
  return [
    bot(
      "Tu pago quedó *pendiente de confirmación* en Mercado Pago (puede pasar con algunos medios de pago). Todavía no está reservado el turno — en cuanto se acredite te confirmamos automáticamente. Si pasan más de unas horas y no tenés novedades, escribinos.",
      { link: { label: "Ir a WhatsApp", href: waLink(waMsg) } },
    ),
  ]
}

function errorMessages(_error: string, draft: OrderDraft): ChatMessage[] {
  const fallbackMsg =
    `Hola! Quiero reservar el pack ${PACKS[draft.pack!]?.name || ""} — turno ${draft.turno ? formatSlotLabel(draft.turno) : ""}. ` +
    `Nombre: ${draft.nombre || "-"}.`
  return [
    bot(
      "Ups, hubo un problema al guardar tu reserva. Podés reintentar o continuar por WhatsApp con tus datos ya cargados.",
      {
        chips: [
          { label: "Reintentar", payload: "retry" },
          { label: "Empezar de nuevo", payload: "reset" },
        ],
        link: { label: "Ir a WhatsApp", href: waLink(fallbackMsg) },
      },
    ),
  ]
}

const slotTakenMessage: ChatMessage = bot(
  "Ese turno se acaba de ocupar 😕 Elegí otro por favor.",
)

// ─────────────────────────────── DETECT FREE TEXT ─────────────────────────────

export function detectPayload(text: string): string {
  const t = text.toLowerCase()
  if (/(platino)/.test(t)) return "platino"
  if (/(diamante)/.test(t)) return "diamante"
  if (/(pack|precio|cuesta|vale|cuanto|cu[aá]nto)/.test(t)) return "packs"
  if (/(c[oó]mo|funciona|proceso|paso)/.test(t)) return "como"
  if (/(seguro|riesgo|romper|da[ñn]ar)/.test(t)) return "seguro"
  if (/(reservar|reserva|turno|comprar|quiero)/.test(t)) return "reservar"
  return "unknown"
}

// ─────────────────────────────────── REDUCER ──────────────────────────────────

function pushMessages(ctx: FlowContext, msgs: ChatMessage[]): FlowContext {
  const withIds: ChatMessage[] = []
  let id = ctx.nextId
  for (const m of msgs) {
    withIds.push({ ...m, id: id++ })
  }
  return { ...ctx, nextId: id, messages: [...ctx.messages, ...withIds] }
}

function pushUser(ctx: FlowContext, text: string): FlowContext {
  return pushMessages(ctx, [user(text)])
}

function transition(ctx: FlowContext, newState: FlowState): FlowContext {
  return {
    ...ctx,
    state: newState,
    mode: isExpanded(newState) ? "expanded" : "compact",
    stateAnchors: { ...ctx.stateAnchors, [newState]: ctx.messages.length },
  }
}

function back(ctx: FlowContext, prevState: FlowState): FlowContext {
  const anchor = ctx.stateAnchors[prevState]
  const messages =
    typeof anchor === "number" ? ctx.messages.slice(0, anchor) : ctx.messages
  return {
    ...ctx,
    state: prevState,
    mode: isExpanded(prevState) ? "expanded" : "compact",
    messages,
    error: undefined,
  }
}

export function reduce(ctx: FlowContext, ev: FlowEvent): FlowContext {
  // Eventos globales
  if (ev.type === "RESET") {
    const fresh = initialContext()
    return pushMessages(fresh, GREETING)
  }

  if (ev.type === "HYDRATE") {
    return {
      ...initialContext(),
      draft: ev.draft,
      state: ev.state,
      mode: isExpanded(ev.state) ? "expanded" : "compact",
    }
  }

  if (ev.type === "MP_RETURN") {
    const fresh = initialContext()
    if (ev.status === "success") {
      const withBot = pushMessages(fresh, confirmedMessages(ev.draft, ""))
      return transition({ ...withBot, draft: ev.draft }, "confirmed")
    }
    if (ev.status === "pending") {
      // Estado "error" solo por conveniencia de UI (no muestra el selector
      // de pago ni dispara el pixel de conversión, a diferencia de
      // "payment"/"confirmed") — el mensaje real es el de pendingMessages.
      const withPending = pushMessages(fresh, pendingMessages(ev.draft))
      return transition({ ...withPending, draft: ev.draft }, "error")
    }
    const withPayment = pushMessages(fresh, paymentMessages(ev.draft))
    const withError = pushMessages(withPayment, [
      bot(
        "El pago con Mercado Pago no se completó. Podés intentarlo de nuevo o elegir otro método de pago 👇",
      ),
    ])
    return transition({ ...withError, draft: ev.draft }, "payment")
  }

  if (ev.type === "OPEN" && ctx.state === "idle") {
    return transition(pushMessages(ctx, GREETING), "greeting")
  }

  if (ev.type === "CLOSE") {
    return { ...ctx, mode: ctx.mode } // no cambia nada; el launcher controla visibilidad
  }

  switch (ctx.state) {
    case "greeting":
    case "exploring":
      if (ev.type === "SELECT_CHIP") {
        const { payload, label } = ev
        if (payload === "platino" || payload === "diamante") {
          const pack = payload as Pack
          const withUser = pushUser(ctx, label)
          const withBot = pushMessages(withUser, planPickedMessages(pack))
          return transition(
            {
              ...withBot,
              draft: { ...ctx.draft, pack, monto: getArs(pack) },
            },
            "planPicked",
          )
        }
        if (payload === "reservar") {
          const withUser = pushUser(ctx, label)
          return startReservation(withUser)
        }
        if (BOT_INFO[payload]) {
          const withUser = pushUser(ctx, label)
          const withBot = pushMessages(withUser, BOT_INFO[payload])
          return transition(withBot, "exploring")
        }
      }
      if (ev.type === "FREE_TEXT") {
        const withUser = pushUser(ctx, ev.text)
        const payload = detectPayload(ev.text)
        if (payload === "platino" || payload === "diamante") {
          const pack = payload as Pack
          const withBot = pushMessages(withUser, planPickedMessages(pack))
          return transition(
            {
              ...withBot,
              draft: { ...ctx.draft, pack, monto: getArs(pack) },
            },
            "planPicked",
          )
        }
        if (payload === "reservar") return startReservation(withUser)
        if (BOT_INFO[payload]) {
          const withBot = pushMessages(withUser, BOT_INFO[payload])
          return transition(withBot, "exploring")
        }
        const withFallback = pushMessages(withUser, [
          bot(
            "Mmm, no te entendí del todo. ¿Querés ver los packs o reservar?",
            {
              chips: [
                { label: "Ver packs", payload: "packs" },
                { label: "Reservar", payload: "reservar" },
              ],
            },
          ),
        ])
        return transition(withFallback, "exploring")
      }
      break

    case "planPicked":
      if (ev.type === "SELECT_CHIP") {
        const { payload, label } = ev
        if (payload === "reservar") {
          return startReservation(pushUser(ctx, label))
        }
        if (payload === "packs" || payload === "platino" || payload === "diamante") {
          return reduce(transition(ctx, "exploring"), ev)
        }
      }
      if (ev.type === "START_RESERVATION") return startReservation(ctx)
      break

    case "askName":
      if (ev.type === "SET_NAME") {
        const withUser = pushUser(ctx, ev.value)
        const withBot = pushMessages(withUser, askWhatsappMessages())
        return transition(
          { ...withBot, draft: { ...ctx.draft, nombre: ev.value }, error: undefined },
          "askWhatsapp",
        )
      }
      break

    case "askWhatsapp":
      if (ev.type === "SET_WHATSAPP") {
        const withUser = pushUser(ctx, ev.value)
        const withBot = pushMessages(withUser, pickSlotMessages())
        // Discord se omite: se setea un placeholder para satisfacer el backend.
        return transition(
          {
            ...withBot,
            draft: { ...ctx.draft, whatsapp: ev.value, discord: "-" },
            error: undefined,
          },
          "pickSlot",
        )
      }
      if (ev.type === "BACK") return back(ctx, "askName")
      break

    case "pickSlot":
      if (ev.type === "PICK_SLOT") {
        const withUser = pushUser(ctx, formatSlotLabel(ev.slotIso))
        const draftNext = { ...ctx.draft, turno: ev.slotIso }
        const withBot = pushMessages(withUser, reviewMessages(draftNext))
        return transition({ ...withBot, draft: draftNext }, "review")
      }
      if (ev.type === "BACK") return back(ctx, "askWhatsapp")
      break

    case "review":
      if (ev.type === "CONFIRM_REVIEW") {
        const withBot = pushMessages(ctx, paymentMessages(ctx.draft))
        return transition(withBot, "payment")
      }
      if (ev.type === "BACK") {
        return back(
          { ...ctx, draft: { ...ctx.draft, turno: undefined } },
          "pickSlot",
        )
      }
      break

    case "payment":
      if (ev.type === "CONFIRM_PAYMENT") {
        const withBot = pushMessages(ctx, uploadProofMessages())
        return transition(withBot, "uploadProof")
      }
      if (ev.type === "SET_ORDER_KEY") {
        // Reservamos un idempotencyKey único apenas se entra a pagar, así los
        // 3 métodos (transferencia/binance/MP) comparten el mismo si el
        // cliente cambia de método a mitad de camino.
        if (ctx.draft.idempotencyKey) return ctx
        return { ...ctx, draft: { ...ctx.draft, idempotencyKey: ev.key } }
      }
      if (ev.type === "BACK") return back(ctx, "review")
      break

    case "uploadProof":
      if (ev.type === "UPLOAD_FILE") {
        const key = ctx.draft.idempotencyKey || randomId()
        return {
          ...ctx,
          draft: { ...ctx.draft, file: ev.file, idempotencyKey: key },
          state: "submitting",
          mode: "expanded",
          messages: [...ctx.messages, { ...submittingMessages()[0], id: ctx.nextId }],
          nextId: ctx.nextId + 1,
        }
      }
      if (ev.type === "BACK") return back(ctx, "payment")
      break

    case "submitting":
      if (ev.type === "SUBMIT_OK") {
        const withBot = pushMessages(ctx, confirmedMessages(ctx.draft, ev.fileUrl))
        return transition(withBot, "confirmed")
      }
      if (ev.type === "SUBMIT_ERR") {
        if (ev.error === "slot_taken") {
          const withBot = pushMessages(ctx, [slotTakenMessage, ...pickSlotMessages()])
          return transition(
            { ...withBot, draft: { ...ctx.draft, turno: undefined } },
            "pickSlot",
          )
        }
        const withBot = pushMessages(ctx, errorMessages(ev.error, ctx.draft))
        return transition({ ...withBot, error: ev.error }, "error")
      }
      break

    case "error":
      if (ev.type === "SELECT_CHIP") {
        if (ev.payload === "retry") {
          return {
            ...ctx,
            state: "submitting",
            messages: [...ctx.messages, { ...submittingMessages()[0], id: ctx.nextId }],
            nextId: ctx.nextId + 1,
          }
        }
        if (ev.payload === "reset") {
          const fresh = initialContext()
          return pushMessages(fresh, GREETING)
        }
      }
      break

    case "confirmed":
      // Terminal; solo acepta RESET
      break
  }

  return ctx
}

function startReservation(ctx: FlowContext): FlowContext {
  // Si no hay pack seleccionado, preguntar antes de pedir datos
  if (!ctx.draft.pack) {
    const msg = pushMessages(ctx, [
      bot("Genial 🚀 ¿Qué pack querés reservar?", {
        chips: [
          { label: `Platino (${formatARS(getArs("platino"))})`, payload: "platino" },
          { label: `Diamante (${formatARS(getArs("diamante"))})`, payload: "diamante" },
        ],
      }),
    ])
    return transition(msg, "exploring")
  }
  const withBot = pushMessages(ctx, askNameMessages())
  return transition(withBot, "askName")
}

export { WHATSAPP_MESSAGE_GENERAL as WA_GENERAL_MSG }
