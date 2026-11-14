import type {
  ChatMessage,
  FlowEvent,
  FlowState,
  OrderDraft,
  Pack,
} from "../types/order"
import { PACKS, isPack } from "./packs"
import { armadoDeadline, armadoResumen } from "./armado"
import { formatARS, formatSlotLabel } from "./formatters"
import { randomId } from "./crypto"
import { MP_ALIAS, waLink, WHATSAPP_MESSAGE_GENERAL } from "./constants"
import { withAdReturnLink } from "./deeplink"
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
  "askEmail",
  "askDiscord",
  "pickSlot",
  "armadoTipo",
  "armadoPresupuesto",
  "armadoPcActual",
  "armadoUso",
  "armadoFuturo",
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
      `Tenemos 4 packs:\n\n⚡ *Platino* — ${formatARS(getArs("platino"))}\n${PACKS.platino.tagline}\n\n💎 *Diamante* — ${formatARS(getArs("diamante"))}\n${PACKS.diamante.tagline}\n\n🔄 *Diamante + Formateo* — ${formatARS(getArs("formateo"))}\n${PACKS.formateo.tagline}\n\n💻 *Notebooks* — ${formatARS(getArs("notebooks"))}\n${PACKS.notebooks.tagline}\n\nY si todavía no tenés la PC o querés mejorarla:\n\n🧩 *Armado de PC* — ${formatARS(getArs("armado"))}\n${PACKS.armado.tagline}`,
      {
        chips: [
          { label: "Quiero Platino", payload: "platino" },
          { label: "Quiero Diamante", payload: "diamante" },
          { label: "Quiero Diamante + Formateo", payload: "formateo" },
          { label: "Quiero Notebooks", payload: "notebooks" },
          { label: "Quiero Armado de PC", payload: "armado" },
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
  if (pack === "armado") {
    return [
      bot(
        `${p.emoji} Elegiste *${p.name}* (${formatARS(getArs(pack))}).\nTe hago unas preguntas, pagás, y en 24 a 48 hs te mando por WhatsApp qué comprar. No hay sesión remota ni turno.\n¿Arrancamos?`,
        {
          chips: [
            { label: "Sí, empezar", payload: "reservar" },
            { label: "Ver los packs", payload: "packs" },
          ],
        },
      ),
    ]
  }
  return [
    bot(
      `${p.emoji} Elegiste el pack *${p.name}* (${formatARS(getArs(pack))}).\n¿Querés reservar tu turno ahora?`,
      {
        chips: [
          { label: "Sí, reservar", payload: "reservar" },
          { label: "Ver los otros packs", payload: "packs" },
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
    bot("Genial. ¿Cuál es tu número de *WhatsApp*?\nSolo el código de área + número, sin el 54 9 (ej: 3382677871).\nSi sos de otro país, poné el código de tu país adelante (ej: +56 9 1234 5678)."),
  ]
}

// Paso OBLIGATORIO (19/10, antes tenía el botón "Prefiero no dejarlo"). El
// texto dice para qué es, porque pedir un mail sin motivo en la mitad de una
// compra hace abandonar.
function askEmailMessages(): ChatMessage[] {
  return [
    bot("¿Me dejás tu *mail*?"),
  ]
}

function pickSlotMessages(): ChatMessage[] {
  return [
    bot("Elegí el día y horario que prefieras 👇"),
  ]
}

// ── Cuestionario de "Armado de PC" (va en lugar del selector de turnos) ──

function armadoTipoMessages(): ChatMessage[] {
  return [
    bot("¿Vas a *armar una PC de cero* o querés *mejorar la que ya tenés*?", {
      chips: [
        { label: "Armar de cero", payload: "armado_cero" },
        { label: "Mejorar la que tengo", payload: "armado_mejora" },
      ],
    }),
  ]
}

function armadoPresupuestoMessages(): ChatMessage[] {
  return [bot("¿Cuál es tu *presupuesto*? Poné el monto máximo que podés gastar.")]
}

function armadoPcActualMessages(): ChatMessage[] {
  return [
    bot(
      "¿Qué *PC tenés hoy*? Pasame:\n• Procesador\n• Placa de video\n• Motherboard\n• Fuente\n• RAM (marca y velocidad)\n• Cooler del procesador, si le compraste uno aparte",
    ),
  ]
}

function armadoUsoMessages(): ChatMessage[] {
  return [
    bot("¿*Para qué la querés*? Contame qué juegos jugás, en qué resolución y cuántos FPS buscás."),
  ]
}

function armadoFuturoMessages(): ChatMessage[] {
  return [
    bot("¿Pensás *seguir mejorándola* más adelante?", {
      chips: [
        { label: "Sí", payload: "armado_si" },
        { label: "No, que quede así", payload: "armado_no" },
      ],
    }),
  ]
}

function armadoReviewMessages(draft: OrderDraft): ChatMessage[] {
  const lineas = [
    `🧩 *${PACKS.armado.name}* — ${formatARS(draft.monto || 0)}`,
    `👤 ${draft.nombre}`,
    `📱 ${draft.whatsapp}`,
    `🛠️ ${draft.armadoTipo === "mejora" ? "Mejorar la PC que tenés" : "Armar de cero"}`,
    `💰 Presupuesto: ${draft.armadoPresupuesto || "-"}`,
  ]
  if (draft.armadoTipo === "mejora") lineas.push(`🖥️ PC actual: ${draft.armadoPcActual || "-"}`)
  lineas.push(`🎮 ${draft.armadoUso || "-"}`)
  lineas.push(`🔧 Seguir mejorándola: ${draft.armadoFuturo === "no" ? "no" : "sí"}`)
  return [
    bot(
      `Revisá tu pedido:\n\n${lineas.join("\n")}\n\n📦 Te mando la lista por WhatsApp en 24 a 48 hs.\n📌 La lista se entrega una sola vez, sin ajustes.\n\n¿Confirmás?`,
    ),
  ]
}

function reviewMessages(draft: OrderDraft): ChatMessage[] {
  if (draft.pack === "armado") return armadoReviewMessages(draft)
  return [
    bot(
      `Revisá tu pedido:\n\n${PACKS[draft.pack!].emoji} *${PACKS[draft.pack!].name}* — ${formatARS(draft.monto || 0)}\n👤 ${draft.nombre}\n📱 ${draft.whatsapp}\n📅 ${formatSlotLabel(draft.turno!)}\n\n📌 El turno se cambia una sola vez, avisando 24 hs antes.\n🛟 Incluye 10 días de soporte desde el día de la optimización. Pasado ese plazo, el trabajo se vuelve a cobrar.\n\n¿Confirmás?`,
    ),
  ]
}

function paymentMessages(draft: OrderDraft): ChatMessage[] {
  return [
    bot(
      `Perfecto. Pagá *${formatARS(draft.monto || 0)}* por *transferencia* (alias \`${MP_ALIAS}\`) o con *Mercado Pago*. Elegí abajo cuál usás 👇`,
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
  if (draft.pack === "armado") {
    return [
      bot(
        "¡Listo! 🎉 Recibí tu pedido de *Armado de PC*.\n\nEn 24 a 48 hs te mando por WhatsApp qué comprar según tu presupuesto. La lista se entrega una sola vez, sin ajustes.",
        { variant: "success" },
      ),
    ]
  }
  return [
    bot(
      `¡Listo! 🎉 Tu turno quedó reservado para *${formatSlotLabel(draft.turno!)}*.\n\nTe escribo al WhatsApp 10 minutos antes de la hora pactada. Mientras tanto, descargá AnyDesk desde anydesk.com. Si tu pack incluye optimización de BIOS, al momento de configurarla te hago una videollamada por WhatsApp para que puedas enfocarme el monitor y la hacemos juntos.\n\nPodés cambiar el turno una sola vez, avisando por WhatsApp con al menos 24 horas de anticipación. Tenés 10 días de soporte por WhatsApp desde el día de la optimización.`,
      { variant: "success" },
    ),
  ]
}

// Mercado Pago puede volver con el pago en estado "pending" (revisión del
// medio de pago, no necesariamente un rechazo). Nada está reservado
// todavía — la reserva recién se crea cuando el webhook ve el pago
// aprobado — así que NO reutilizamos el mensaje de éxito acá.
function pendingMessages(draft: OrderDraft): ChatMessage[] {
  const esArmado = draft.pack === "armado"
  const waMsg = esArmado
    ? `Hola! Pagué el Armado de PC con Mercado Pago y quedó "pendiente". Nombre: ${draft.nombre || "-"}.`
    : `Hola! Pagué el pack ${PACKS[draft.pack!]?.name || ""} con Mercado Pago y quedó "pendiente". ` +
      `Turno: ${draft.turno ? formatSlotLabel(draft.turno) : ""}. Nombre: ${draft.nombre || "-"}.`
  // A propósito NO se le suma acá el link de regreso de anuncio
  // (withAdReturnLink): la persona YA pagó, mandarle un "reservá directo"
  // invita a un doble pago. La atribución del pago pendiente se resuelve
  // igual server-side cuando el webhook de MP lo acredita.
  return [
    bot(
      esArmado
        ? "Tu pago quedó *pendiente de confirmación* en Mercado Pago (puede pasar con algunos medios de pago). Tu pedido todavía no quedó registrado — en cuanto se acredite queda confirmado automáticamente. Si pasan más de unas horas y no tenés novedades, escribinos."
        : "Tu pago quedó *pendiente de confirmación* en Mercado Pago (puede pasar con algunos medios de pago). Todavía no está reservado el turno — en cuanto se acredite te confirmamos automáticamente. Si pasan más de unas horas y no tenés novedades, escribinos.",
      { link: { label: "Ir a WhatsApp", href: waLink(waMsg) } },
    ),
  ]
}

function errorMessages(_error: string, draft: OrderDraft): ChatMessage[] {
  const fallbackMsg =
    draft.pack === "armado"
      ? `Hola! Quiero pedir el Armado de PC. Nombre: ${draft.nombre || "-"}. ${armadoResumen(draft)}`
      : `Hola! Quiero reservar el pack ${PACKS[draft.pack!]?.name || ""} — turno ${draft.turno ? formatSlotLabel(draft.turno) : ""}. ` +
        `Nombre: ${draft.nombre || "-"}.`
  // La reserva NO se guardó, así que acá sí tiene sentido arrastrar el link
  // de regreso de anuncio: si la persona vino de una pauta y sigue por
  // WhatsApp, la compra que se cierre después (manual o web) mantiene la
  // atribución. Sin anuncio de origen, withAdReturnLink() no cambia nada.
  return [
    bot(
      "Ups, hubo un problema al guardar tu reserva. Podés reintentar o continuar por WhatsApp con tus datos ya cargados.",
      {
        chips: [
          { label: "Reintentar", payload: "retry" },
          { label: "Empezar de nuevo", payload: "reset" },
        ],
        link: { label: "Ir a WhatsApp", href: waLink(withAdReturnLink(fallbackMsg)) },
      },
    ),
  ]
}

const slotTakenMessage: ChatMessage = bot(
  "Ese turno se acaba de ocupar 😕 Elegí otro por favor.",
)

// Mensaje(s) del bot que corresponden a cada estado retomable, para
// reconstruirlos al hidratar un pedido sin terminar (ver HYDRATE en el
// reducer). Los estados que no aparacen acá no necesitan mensaje porque el
// FlowRenderer ya dibuja su propio control.
function resumeMessages(state: FlowState, draft: OrderDraft): ChatMessage[] {
  // draft.pack puede ser un string basura si el localStorage quedó corrupto o
  // es de otra versión — se chequea que sea un pack REAL (no sólo truthy)
  // antes de armar cualquier mensaje que acceda a PACKS[...], para no tirar un
  // TypeError adentro del reducer y crashear el chat.
  const validPack = draft.pack && PACKS[draft.pack] ? draft.pack : undefined
  switch (state) {
    case "planPicked":
      return validPack ? planPickedMessages(validPack) : []
    case "askName":
      return askNameMessages()
    case "askWhatsapp":
      return askWhatsappMessages()
    case "askEmail":
      return askEmailMessages()
    case "pickSlot":
      return pickSlotMessages()
    case "armadoTipo":
      return armadoTipoMessages()
    case "armadoPresupuesto":
      return armadoPresupuestoMessages()
    case "armadoPcActual":
      return armadoPcActualMessages()
    case "armadoUso":
      return armadoUsoMessages()
    case "armadoFuturo":
      return armadoFuturoMessages()
    case "review":
      return validPack && draft.turno ? reviewMessages(draft) : []
    case "payment":
      return paymentMessages(draft)
    case "uploadProof":
      return uploadProofMessages()
    default:
      return []
  }
}

// ─────────────────────────────── DETECT FREE TEXT ─────────────────────────────

export function detectPayload(text: string): string {
  const t = text.toLowerCase()
  if (/(platino)/.test(t)) return "platino"
  if (/(notebook|laptop|port[aá]til)/.test(t)) return "notebooks"
  // Antes que "diamante": "diamante + formateo" también matchea /diamante/.
  if (/(format)/.test(t)) return "formateo"
  if (/(diamante)/.test(t)) return "diamante"
  if (/(armad|armar|qu[eé] comprar|upgrade)/.test(t)) return "armado"
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
    // OJO: el estado tiene que quedar en "greeting", NO en "idle". En "idle"
    // el reducer ignora TODOS los clics de chip y el texto libre — el único
    // evento que saca de "idle" es OPEN, que lo dispara un efecto de
    // useChatFlow que queda deshabilitado (greeted.current = true) justo
    // después de un RESET. Si RESET dejaba "idle", el chat quedaba visible
    // pero muerto hasta recargar la página. Bug real: tocar "Descartar" en el
    // banner de "pedido sin terminar", o "Empezar de nuevo" tras un error.
    return transition(pushMessages(initialContext(), GREETING), "greeting")
  }

  if (ev.type === "HYDRATE") {
    const base: FlowContext = {
      ...initialContext(),
      draft: ev.draft,
      state: ev.state,
      mode: isExpanded(ev.state) ? "expanded" : "compact",
    }
    // HYDRATE arranca sin mensajes. Para estados con formulario propio
    // (askName, pickSlot, pago…) el FlowRenderer igual dibuja el control, pero
    // "planPicked" NO tiene control y sus botones ("Sí, reservar" / "Ver el
    // otro pack") vivían en un mensaje que se perdió → ventana en blanco sin
    // salida. Regeneramos el mensaje que corresponde al estado retomado.
    return pushMessages(base, resumeMessages(ev.state, ev.draft))
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
        if (isPack(payload)) {
          const pack = payload
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
        if (isPack(payload)) {
          const pack = payload
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
        if (payload === "packs" || isPack(payload)) {
          return reduce(transition(ctx, "exploring"), ev)
        }
      }
      if (ev.type === "START_RESERVATION") return startReservation(ctx)
      // El input de texto queda visible en "planPicked" — si la persona
      // escribe ("sí dale", "cuánto sale") NO puede quedar en silencio. Se
      // pasa a "exploring" (conserva draft.pack) que sí interpreta texto libre.
      if (ev.type === "FREE_TEXT") return reduce(transition(ctx, "exploring"), ev)
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
        const withBot = pushMessages(withUser, askEmailMessages())
        // Discord se omite: se setea un placeholder para satisfacer el backend.
        return transition(
          {
            ...withBot,
            draft: { ...ctx.draft, whatsapp: ev.value, discord: "-" },
            error: undefined,
          },
          "askEmail",
        )
      }
      if (ev.type === "BACK") return back(ctx, "askName")
      break

    // Paso OBLIGATORIO: la única salida hacia pickSlot es dejar el mail.
    case "askEmail":
      if (ev.type === "SET_EMAIL") {
        const withUser = pushUser(ctx, ev.value)
        // Armado de PC no tiene turno: en vez del selector de horarios van
        // las preguntas del cuestionario.
        if (ctx.draft.pack === "armado") {
          const withArmado = pushMessages(withUser, armadoTipoMessages())
          return transition(
            { ...withArmado, draft: { ...ctx.draft, email: ev.value }, error: undefined },
            "armadoTipo",
          )
        }
        const withBot = pushMessages(withUser, pickSlotMessages())
        return transition(
          { ...withBot, draft: { ...ctx.draft, email: ev.value }, error: undefined },
          "pickSlot",
        )
      }
      if (ev.type === "BACK") return back(ctx, "askWhatsapp")
      break

    case "pickSlot":
      if (ev.type === "PICK_SLOT") {
        const withUser = pushUser(ctx, formatSlotLabel(ev.slotIso))
        const draftNext = { ...ctx.draft, turno: ev.slotIso }
        const withBot = pushMessages(withUser, reviewMessages(draftNext))
        return transition({ ...withBot, draft: draftNext }, "review")
      }
      if (ev.type === "BACK") return back(ctx, "askEmail")
      break

    case "armadoTipo":
      if (ev.type === "SELECT_CHIP" && (ev.payload === "armado_cero" || ev.payload === "armado_mejora")) {
        const armadoTipo = ev.payload === "armado_mejora" ? "mejora" : "cero"
        const withBot = pushMessages(pushUser(ctx, ev.label), armadoPresupuestoMessages())
        return transition(
          {
            ...withBot,
            draft: {
              ...ctx.draft,
              armadoTipo,
              // Si cambió de "mejorar" a "de cero", la PC actual ya no aplica.
              armadoPcActual: armadoTipo === "mejora" ? ctx.draft.armadoPcActual : undefined,
            },
          },
          "armadoPresupuesto",
        )
      }
      if (ev.type === "BACK") return back(ctx, "askEmail")
      break

    case "armadoPresupuesto":
      if (ev.type === "ARMADO_ANSWER") {
        const mejora = ctx.draft.armadoTipo === "mejora"
        const withBot = pushMessages(
          pushUser(ctx, ev.value),
          mejora ? armadoPcActualMessages() : armadoUsoMessages(),
        )
        return transition(
          { ...withBot, draft: { ...ctx.draft, armadoPresupuesto: ev.value } },
          mejora ? "armadoPcActual" : "armadoUso",
        )
      }
      if (ev.type === "BACK") return back(ctx, "armadoTipo")
      break

    case "armadoPcActual":
      if (ev.type === "ARMADO_ANSWER") {
        const withBot = pushMessages(pushUser(ctx, ev.value), armadoUsoMessages())
        return transition(
          { ...withBot, draft: { ...ctx.draft, armadoPcActual: ev.value } },
          "armadoUso",
        )
      }
      if (ev.type === "BACK") return back(ctx, "armadoPresupuesto")
      break

    case "armadoUso":
      if (ev.type === "ARMADO_ANSWER") {
        const withBot = pushMessages(pushUser(ctx, ev.value), armadoFuturoMessages())
        return transition(
          { ...withBot, draft: { ...ctx.draft, armadoUso: ev.value } },
          "armadoFuturo",
        )
      }
      if (ev.type === "BACK") {
        return back(ctx, ctx.draft.armadoTipo === "mejora" ? "armadoPcActual" : "armadoPresupuesto")
      }
      break

    case "armadoFuturo":
      if (ev.type === "SELECT_CHIP" && (ev.payload === "armado_si" || ev.payload === "armado_no")) {
        const conRespuesta: OrderDraft = {
          ...ctx.draft,
          armadoFuturo: ev.payload === "armado_no" ? "no" : "si",
        }
        // `turno` (fecha límite de entrega) y `discord` (las respuestas) se
        // vuelven a calcular al mandar el pedido — ver prepararArmado. Acá
        // quedan cargados para que el resumen y el pago tengan el pedido
        // completo.
        const draftNext: OrderDraft = {
          ...conRespuesta,
          turno: armadoDeadline(),
          discord: armadoResumen(conRespuesta),
        }
        const withBot = pushMessages(pushUser(ctx, ev.label), reviewMessages(draftNext))
        return transition({ ...withBot, draft: draftNext }, "review")
      }
      if (ev.type === "BACK") return back(ctx, "armadoUso")
      break

    case "review":
      if (ev.type === "CONFIRM_REVIEW") {
        const withBot = pushMessages(ctx, paymentMessages(ctx.draft))
        return transition(withBot, "payment")
      }
      if (ev.type === "BACK") {
        if (ctx.draft.pack === "armado") return back(ctx, "armadoFuturo")
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
        // Un armado no elige turno: si igual llegara un "slot_taken" (ya se
        // reintentó solo, ver enviarArmadoConReintento) va al error común en
        // vez de mandarlo a un selector de horarios que no le corresponde.
        if (ev.error === "slot_taken" && ctx.draft.pack !== "armado") {
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
          // Mismo criterio que el RESET global: dejar "greeting", no "idle".
          return transition(pushMessages(initialContext(), GREETING), "greeting")
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
          { label: `Diamante + Formateo (${formatARS(getArs("formateo"))})`, payload: "formateo" },
          { label: `Notebooks (${formatARS(getArs("notebooks"))})`, payload: "notebooks" },
          { label: `Armado de PC (${formatARS(getArs("armado"))})`, payload: "armado" },
        ],
      }),
    ])
    return transition(msg, "exploring")
  }
  const withBot = pushMessages(ctx, askNameMessages())
  return transition(withBot, "askName")
}

export { WHATSAPP_MESSAGE_GENERAL as WA_GENERAL_MSG }
