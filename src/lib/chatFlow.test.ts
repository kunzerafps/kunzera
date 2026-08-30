import { describe, expect, it } from "vitest"
import { GREETING, initialContext, isExpanded, reduce } from "./chatFlow"
import type { FlowContext } from "./chatFlow"
import type { FlowEvent, OrderDraft } from "../types/order"

// El reducer del chat es una función pura — se prueba directo, sin DOM.
function run(events: FlowEvent[], start: FlowContext = initialContext()): FlowContext {
  return events.reduce((ctx, ev) => reduce(ctx, ev), start)
}

const SLOT = "2026-09-05T15:00:00.000Z"

function lastChips(ctx: FlowContext): string[] {
  for (let i = ctx.messages.length - 1; i >= 0; i--) {
    const c = ctx.messages[i].chips
    if (c && c.length) return c.map((x) => x.payload)
  }
  return []
}

describe("chatFlow reducer — happy path", () => {
  it("OPEN saca de idle a greeting y muestra el saludo", () => {
    const ctx = run([{ type: "OPEN" }])
    expect(ctx.state).toBe("greeting")
    expect(ctx.messages.length).toBe(GREETING.length)
    expect(lastChips(ctx)).toContain("reservar")
  })

  it("recorrido completo hasta uploadProof", () => {
    const ctx = run([
      { type: "OPEN" },
      { type: "SELECT_CHIP", payload: "diamante", label: "Quiero Diamante" },
      { type: "SELECT_CHIP", payload: "reservar", label: "Sí, reservar" },
      { type: "SET_NAME", value: "Juan Perez" },
      { type: "SET_WHATSAPP", value: "3511234567" },
      { type: "SET_EMAIL", value: "juan@gmail.com" },
      { type: "PICK_SLOT", slotIso: SLOT },
      { type: "CONFIRM_REVIEW" },
      { type: "CONFIRM_PAYMENT" },
    ])
    expect(ctx.state).toBe("uploadProof")
    expect(ctx.draft.pack).toBe("diamante")
    expect(ctx.draft.nombre).toBe("Juan Perez")
    expect(ctx.draft.whatsapp).toBe("3511234567")
    expect(ctx.draft.email).toBe("juan@gmail.com")
    expect(ctx.draft.discord).toBe("-")
    expect(ctx.draft.turno).toBe(SLOT)
  })
})

// ─────────── Paso del mail (opcional) ───────────
// Es la señal que más sube la precisión con la que Meta reconoce al comprador
// y la que más faltaba: llegaba solo en el 40% de las compras. Tiene que
// sumar cobertura SIN frenar a nadie, por eso es salteable.
describe("chatFlow reducer — paso del mail (opcional)", () => {
  const hastaElMail = [
    { type: "OPEN" } as const,
    { type: "SELECT_CHIP", payload: "platino", label: "Quiero Platino" } as const,
    { type: "SELECT_CHIP", payload: "reservar", label: "Sí, reservar" } as const,
    { type: "SET_NAME", value: "Ana Gomez" } as const,
    { type: "SET_WHATSAPP", value: "3511234567" } as const,
  ]

  it("después del WhatsApp pregunta el mail, no salta directo al calendario", () => {
    const ctx = run([...hastaElMail])
    expect(ctx.state).toBe("askEmail")
  })

  it("dejando el mail sigue al calendario y lo guarda", () => {
    const ctx = run([...hastaElMail, { type: "SET_EMAIL", value: "ana@gmail.com" }])
    expect(ctx.state).toBe("pickSlot")
    expect(ctx.draft.email).toBe("ana@gmail.com")
  })

  it("saltearlo sigue al calendario igual, sin mail y sin costar un paso extra", () => {
    const ctx = run([...hastaElMail, { type: "SKIP_EMAIL" }])
    expect(ctx.state).toBe("pickSlot")
    expect(ctx.draft.email).toBeUndefined()
  })

  it("saltearlo después de haber escrito uno no deja pegado el mail viejo", () => {
    const conMail = run([...hastaElMail, { type: "SET_EMAIL", value: "viejo@gmail.com" }])
    // vuelve atrás y esta vez lo saltea
    const volvio = reduce(conMail, { type: "BACK" })
    expect(volvio.state).toBe("askEmail")
    const ctx = reduce(volvio, { type: "SKIP_EMAIL" })
    expect(ctx.state).toBe("pickSlot")
    expect(ctx.draft.email).toBeUndefined()
  })

  it("BACK desde el mail vuelve al WhatsApp, y desde el calendario vuelve al mail", () => {
    const enMail = run([...hastaElMail])
    expect(reduce(enMail, { type: "BACK" }).state).toBe("askWhatsapp")

    const enSlot = run([...hastaElMail, { type: "SKIP_EMAIL" }])
    expect(reduce(enSlot, { type: "BACK" }).state).toBe("askEmail")
  })

  it("al retomar un pedido guardado en el paso del mail, el chat vuelve a preguntarlo", () => {
    const ctx = reduce(initialContext(), {
      type: "HYDRATE",
      state: "askEmail",
      draft: { pack: "platino", monto: 50000, nombre: "Ana", whatsapp: "3511234567" },
    })
    expect(ctx.state).toBe("askEmail")
    expect(ctx.messages.length).toBeGreaterThan(0)
  })
})

// ─────────── BUG 1 — RESET no debe dejar el chat clavado en "idle" ───────────
describe("chatFlow reducer — RESET (bug: chat muerto tras 'Descartar')", () => {
  it("RESET deja el estado en 'greeting', NO en 'idle'", () => {
    const before = run([
      { type: "OPEN" },
      { type: "SELECT_CHIP", payload: "platino", label: "Quiero Platino" },
    ])
    const ctx = reduce(before, { type: "RESET" })
    expect(ctx.state).toBe("greeting")
    expect(ctx.state).not.toBe("idle")
    expect(ctx.messages.length).toBe(GREETING.length)
  })

  it("después de RESET, el chat SIGUE respondiendo a los clics", () => {
    const ctx = run([
      { type: "OPEN" },
      { type: "SELECT_CHIP", payload: "platino", label: "Quiero Platino" },
      { type: "RESET" },
      { type: "SELECT_CHIP", payload: "packs", label: "Ver packs" },
    ])
    // si RESET dejara "idle" esto sería un no-op y el estado seguiría en "idle"
    expect(ctx.state).toBe("exploring")
    expect(lastChips(ctx)).toEqual(expect.arrayContaining(["platino", "diamante"]))
  })

  it("después de RESET se puede arrancar una reserva de cero", () => {
    const ctx = run([
      { type: "OPEN" },
      { type: "SELECT_CHIP", payload: "diamante", label: "Quiero Diamante" },
      { type: "RESET" },
      { type: "SELECT_CHIP", payload: "reservar", label: "Reservar turno" },
    ])
    // sin pack elegido tras el reset → pregunta el pack (no queda clavado)
    expect(ctx.state).toBe("exploring")
    expect(lastChips(ctx)).toEqual(expect.arrayContaining(["platino", "diamante"]))
  })

  it("'Empezar de nuevo' desde el estado de error también deja 'greeting' navegable", () => {
    const errored = run([
      { type: "OPEN" },
      { type: "SELECT_CHIP", payload: "platino", label: "Quiero Platino" },
      { type: "SELECT_CHIP", payload: "reservar", label: "Sí, reservar" },
      { type: "SET_NAME", value: "Ana Gomez" },
      { type: "SET_WHATSAPP", value: "3511234567" },
      { type: "SKIP_EMAIL" },
      { type: "PICK_SLOT", slotIso: SLOT },
      { type: "CONFIRM_REVIEW" },
      { type: "CONFIRM_PAYMENT" },
      { type: "UPLOAD_FILE", file: { base64: "x", mime: "image/png", name: "c.png", size: 10 } },
      { type: "SUBMIT_ERR", error: "algo_falló" },
    ])
    expect(errored.state).toBe("error")

    const afterReset = reduce(errored, { type: "SELECT_CHIP", payload: "reset", label: "Empezar de nuevo" })
    expect(afterReset.state).toBe("greeting")

    const clicked = reduce(afterReset, { type: "SELECT_CHIP", payload: "reservar", label: "Reservar turno" })
    expect(clicked.state).toBe("exploring") // responde, no está muerto
  })
})

// ─────── BUG 2 — HYDRATE a 'planPicked' dejaba la ventana en blanco ───────
describe("chatFlow reducer — HYDRATE (bug: 'Retomar' con solo el plan → chat en blanco)", () => {
  it("HYDRATE a planPicked regenera el mensaje con los botones", () => {
    const draft: OrderDraft = { pack: "platino", monto: 50000 }
    const ctx = reduce(initialContext(), { type: "HYDRATE", draft, state: "planPicked" })
    expect(ctx.state).toBe("planPicked")
    expect(ctx.messages.length).toBeGreaterThan(0) // ya NO queda vacío
    expect(lastChips(ctx)).toEqual(expect.arrayContaining(["reservar", "packs"]))
  })

  it("tras HYDRATE a planPicked, 'Sí, reservar' avanza a askName", () => {
    const draft: OrderDraft = { pack: "platino", monto: 50000 }
    const ctx = run(
      [
        { type: "HYDRATE", draft, state: "planPicked" },
        { type: "SELECT_CHIP", payload: "reservar", label: "Sí, reservar" },
      ],
    )
    expect(ctx.state).toBe("askName")
  })

  it("en planPicked, escribir texto NO queda en silencio: pasa a exploring y responde", () => {
    const before = run([
      { type: "OPEN" },
      { type: "SELECT_CHIP", payload: "platino", label: "Quiero Platino" },
    ])
    expect(before.state).toBe("planPicked")

    const afterText = reduce(before, { type: "FREE_TEXT", text: "sí dale quiero reservar" })
    expect(afterText).not.toBe(before) // ya no es un no-op
    // "reservar" detectado → arranca la reserva; el pack elegido se conserva
    expect(["askName", "exploring"]).toContain(afterText.state)
    expect(afterText.draft.pack).toBe("platino")

    const afterGibberish = reduce(before, { type: "FREE_TEXT", text: "asdkjh" })
    expect(afterGibberish.state).toBe("exploring")
    expect(afterGibberish.draft.pack).toBe("platino")
  })

  it("HYDRATE a askName / pickSlot / review trae el mensaje que corresponde", () => {
    const forName = reduce(initialContext(), {
      type: "HYDRATE",
      draft: { pack: "platino", monto: 50000 },
      state: "askName",
    })
    expect(forName.messages.length).toBeGreaterThan(0)

    const forSlot = reduce(initialContext(), {
      type: "HYDRATE",
      draft: { pack: "platino", monto: 50000, nombre: "Juan", whatsapp: "3511234567" },
      state: "pickSlot",
    })
    expect(forSlot.messages.length).toBeGreaterThan(0)

    const forReview = reduce(initialContext(), {
      type: "HYDRATE",
      draft: { pack: "diamante", monto: 70000, nombre: "Juan", whatsapp: "3511234567", turno: SLOT },
      state: "review",
    })
    expect(forReview.messages.length).toBeGreaterThan(0)
    expect(forReview.messages.some((m) => m.text.includes("Juan"))).toBe(true)
  })

  it("HYDRATE a planPicked SIN pack (dato corrupto) no rompe y no deja mensajes basura", () => {
    const ctx = reduce(initialContext(), { type: "HYDRATE", draft: {}, state: "planPicked" })
    expect(ctx.state).toBe("planPicked")
    expect(ctx.messages).toEqual([])
    // y sigue siendo navegable por texto/deep-link → START_RESERVATION
    const next = reduce(ctx, { type: "START_RESERVATION" })
    expect(["exploring", "askName"]).toContain(next.state)
  })

  it("HYDRATE con un pack INVÁLIDO (localStorage corrupto/viejo) no crashea el reducer", () => {
    const bad = { pack: "oro-viejo", monto: 999 } as unknown as OrderDraft
    expect(() => reduce(initialContext(), { type: "HYDRATE", draft: bad, state: "planPicked" })).not.toThrow()
    const ctx = reduce(initialContext(), { type: "HYDRATE", draft: bad, state: "planPicked" })
    expect(ctx.state).toBe("planPicked")
    expect(ctx.messages).toEqual([]) // sin mensaje basura
    expect(() =>
      reduce(initialContext(), { type: "HYDRATE", draft: { ...bad, turno: SLOT }, state: "review" }),
    ).not.toThrow()
  })

  it("HYDRATE a payment / uploadProof trae su mensaje y no rompe", () => {
    const forPayment = reduce(initialContext(), {
      type: "HYDRATE",
      draft: { pack: "platino", monto: 50000, nombre: "Juan", whatsapp: "3511234567", turno: SLOT },
      state: "payment",
    })
    expect(forPayment.state).toBe("payment")
    expect(forPayment.messages.length).toBeGreaterThan(0)

    const forUpload = reduce(initialContext(), {
      type: "HYDRATE",
      draft: { pack: "platino", monto: 50000, nombre: "Juan", whatsapp: "3511234567", turno: SLOT },
      state: "uploadProof",
    })
    expect(forUpload.state).toBe("uploadProof")
    expect(forUpload.messages.length).toBeGreaterThan(0)
  })

  it("RESET desde 'exploring' también deja 'greeting' navegable", () => {
    const ctx = run([
      { type: "OPEN" },
      { type: "SELECT_CHIP", payload: "packs", label: "Ver packs" },
      { type: "RESET" },
    ])
    expect(ctx.state).toBe("greeting")
    const clicked = reduce(ctx, { type: "SELECT_CHIP", payload: "seguro", label: "¿Es seguro?" })
    expect(clicked.state).toBe("exploring")
  })

  it("HYDRATE restaura draft y mode expandido para estados de formulario", () => {
    const ctx = reduce(initialContext(), {
      type: "HYDRATE",
      draft: { pack: "platino", monto: 50000, nombre: "Juan", whatsapp: "3511234567" },
      state: "pickSlot",
    })
    expect(ctx.draft.nombre).toBe("Juan")
    expect(ctx.mode).toBe(isExpanded("pickSlot") ? "expanded" : "compact")
  })
})

// ───────────────── comportamiento existente que no se debe romper ─────────────
describe("chatFlow reducer — regresiones", () => {
  it("MP_RETURN success → confirmed", () => {
    const ctx = reduce(initialContext(), {
      type: "MP_RETURN",
      status: "success",
      draft: { pack: "platino", monto: 50000, nombre: "Juan", whatsapp: "3511234567", turno: SLOT },
    })
    expect(ctx.state).toBe("confirmed")
  })

  it("MP_RETURN failure → payment", () => {
    const ctx = reduce(initialContext(), {
      type: "MP_RETURN",
      status: "failure",
      draft: { pack: "platino", monto: 50000, nombre: "Juan", whatsapp: "3511234567", turno: SLOT },
    })
    expect(ctx.state).toBe("payment")
  })

  it("MP_RETURN pending → error (con mensaje de pendiente, sin reusar el de éxito)", () => {
    const ctx = reduce(initialContext(), {
      type: "MP_RETURN",
      status: "pending",
      draft: { pack: "platino", monto: 50000, nombre: "Juan", whatsapp: "3511234567", turno: SLOT },
    })
    expect(ctx.state).toBe("error")
    expect(ctx.messages.some((m) => /pendiente/i.test(m.text))).toBe(true)
  })

  it("desde 'error' (pago MP pendiente, sin chips) se puede volver al saludo con RESET", () => {
    const pending = reduce(initialContext(), {
      type: "MP_RETURN",
      status: "pending",
      draft: { pack: "platino", monto: 50000, nombre: "Juan", whatsapp: "3511234567", turno: SLOT },
    })
    // el botón "Empezar de nuevo" del footer despacha RESET (evento global)
    const back = reduce(pending, { type: "RESET" })
    expect(back.state).toBe("greeting")
    const clicked = reduce(back, { type: "SELECT_CHIP", payload: "reservar", label: "x" })
    expect(clicked.state).toBe("exploring")
  })

  it("BACK desde askWhatsapp vuelve a askName", () => {
    const ctx = run([
      { type: "OPEN" },
      { type: "SELECT_CHIP", payload: "platino", label: "Quiero Platino" },
      { type: "SELECT_CHIP", payload: "reservar", label: "Sí, reservar" },
      { type: "SET_NAME", value: "Juan Perez" },
      { type: "BACK" },
    ])
    expect(ctx.state).toBe("askName")
  })

  it("SUBMIT_ERR slot_taken vuelve a pickSlot y limpia el turno", () => {
    const submitting = run([
      { type: "OPEN" },
      { type: "SELECT_CHIP", payload: "platino", label: "Quiero Platino" },
      { type: "SELECT_CHIP", payload: "reservar", label: "Sí, reservar" },
      { type: "SET_NAME", value: "Juan" },
      { type: "SET_WHATSAPP", value: "3511234567" },
      { type: "SKIP_EMAIL" },
      { type: "PICK_SLOT", slotIso: SLOT },
      { type: "CONFIRM_REVIEW" },
      { type: "CONFIRM_PAYMENT" },
      { type: "UPLOAD_FILE", file: { base64: "x", mime: "image/png", name: "c.png", size: 10 } },
    ])
    const ctx = reduce(submitting, { type: "SUBMIT_ERR", error: "slot_taken" })
    expect(ctx.state).toBe("pickSlot")
    expect(ctx.draft.turno).toBeUndefined()
  })

  it("confirmed es terminal: solo RESET lo saca", () => {
    const confirmed = reduce(initialContext(), {
      type: "MP_RETURN",
      status: "success",
      draft: { pack: "platino", monto: 50000, nombre: "Juan", whatsapp: "3511234567", turno: SLOT },
    })
    const ignored = reduce(confirmed, { type: "SELECT_CHIP", payload: "reservar", label: "x" })
    expect(ignored).toBe(confirmed) // no cambió
    const reset = reduce(confirmed, { type: "RESET" })
    expect(reset.state).toBe("greeting")
  })
})
