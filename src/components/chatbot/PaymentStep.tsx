import { motion } from "framer-motion"
import { ArrowLeft, Check, Copy, CreditCard, Landmark, Wallet } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { OrderDraft } from "../../types/order"
import { BINANCE_EMAIL, MP_ALIAS } from "../../lib/constants"
import { formatARS } from "../../lib/formatters"
import { useSiteConfig } from "../../hooks/useWaMessages"
import { randomId } from "../../lib/crypto"
import { saveDraft } from "../../lib/storage"
import { mpTotal } from "../../lib/pricing"
import { trackPixelEvent } from "../../lib/pixel"

type Props = {
  draft: OrderDraft
  onPaid: () => void
  onBack: () => void
  onKeyReady: (key: string) => void
}

type Method = "transferencia" | "binance" | "mercadopago"

const METHODS: {
  id: Method
  label: string
  icon: typeof CreditCard
}[] = [
  { id: "transferencia", label: "Transferencia", icon: CreditCard },
  { id: "binance", label: "Binance", icon: Wallet },
  { id: "mercadopago", label: "Mercado Pago", icon: Landmark },
]

const ALIAS_METHODS: Record<
  "transferencia" | "binance",
  { fieldLabel: string; value: string; helper: string }
> = {
  transferencia: {
    fieldLabel: "Alias Mercado Pago",
    value: MP_ALIAS,
    helper:
      "Transferí desde la app de Mercado Pago o tu banco al alias. Luego subí el comprobante para confirmar la reserva.",
  },
  binance: {
    fieldLabel: "Email Binance Pay (USDT)",
    value: BINANCE_EMAIL,
    helper:
      "Mandá el equivalente en USDT desde Binance Pay al email. Después subí el comprobante para confirmar la reserva.",
  },
}

function getCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : undefined
}

export default function PaymentStep({ draft, onPaid, onBack, onKeyReady }: Props) {
  const { prices } = useSiteConfig()
  const [method, setMethod] = useState<Method>("transferencia")
  const [copied, setCopied] = useState(false)
  // Qué método se etiqueta al facturar no debería depender de en qué tab
  // haya quedado parado el cliente al tocar "Ya pagué" (switchMethod deja
  // cambiar de tab en cualquier momento, incluso después de pagar) — eso
  // etiquetaría mal si copió el alias de Binance y después volvió a mirar
  // la tab de Transferencia antes de confirmar. Se guarda el método en el
  // momento en que efectivamente copia el dato de pago (la señal más
  // confiable de cuál usó de verdad) y esa es la que se manda a
  // tag-payment-method; si nunca copió nada, se sigue usando el tab activo
  // como antes (mismo comportamiento que ya existía).
  const [paidWithMethod, setPaidWithMethod] = useState<"transferencia" | "binance" | null>(null)
  const [mpLoading, setMpLoading] = useState(false)
  const [mpError, setMpError] = useState<string | null>(null)

  // El idempotencyKey se decide UNA sola vez apenas se entra a pagar (no en
  // cada click) y se comparte con el resto de los métodos vía onKeyReady,
  // para que reintentar o cambiar de método de pago apunten al mismo pedido.
  const [idempotencyKey] = useState(() => draft.idempotencyKey || randomId())

  // Además del check de arriba (que cubre volver a entrar a pagar en una
  // orden que ya tiene idempotencyKey), este ref cubre el doble-mount que
  // hace React StrictMode en desarrollo: las dos invocaciones ocurren antes
  // de que onKeyReady() alcance a actualizar draft.idempotencyKey en el
  // padre, así que ese check solo no alcanza para frenar la segunda -
  // duplicaba InitiateCheckout y el POST a capture-attribution (bug real,
  // encontrado en review). El ref sí sobrevive el mount→cleanup→mount de
  // StrictMode porque es la misma instancia de componente.
  const setupDone = useRef(false)

  useEffect(() => {
    if (draft.idempotencyKey || setupDone.current) return // ya se hizo esto la primera vez que se entró a pagar
    setupDone.current = true
    onKeyReady(idempotencyKey)

    // InitiateCheckout: señal de "entró a pagar", distinta de Purchase (que
    // recién se manda cuando el pago está confirmado de verdad, ver
    // useChatFlow.ts). Cliente-side está bien acá — a diferencia de
    // Purchase, no hace falta que sea a prueba de bloqueadores de anuncios.
    trackPixelEvent("InitiateCheckout", {
      value: draft.monto ?? 0,
      currency: "ARS",
      content_name: draft.pack,
      content_type: "product",
    })

    // Captura fbp/fbc (cookies que el propio píxel de Meta ya puso, nunca
    // se inventan) + IP/user-agent reales del comprador (del lado del
    // servidor, en capture-attribution.mts) — ACÁ, mientras hay una sesión
    // de navegador real. Si esto se capturara recién cuando el admin
    // confirma el pago (transferencia/binance, horas o días después), ya no
    // habría forma de saber la IP/cookies reales de quien compró. Best
    // effort: si falla, el Purchase se manda igual más tarde, sin estos
    // campos.
    void fetch("/api/capture-attribution", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        idempotencyKey,
        fbp: getCookie("_fbp"),
        fbc: getCookie("_fbc"),
      }),
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Si el cliente toca "Pagar con Mercado Pago" y después usa el botón
  // ATRÁS del navegador (en vez del link "Volver a la tienda" de MP), Chrome
  // puede restaurar esta página desde una foto congelada (bfcache) tal como
  // quedó justo antes de irse — con el botón trabado en "Conectando…" para
  // siempre, sin ningún error visible. Al detectar ese caso, liberamos el
  // botón para que pueda reintentar sin recargar la página a mano.
  useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setMpLoading(false)
    }
    window.addEventListener("pageshow", handlePageShow)
    return () => window.removeEventListener("pageshow", handlePageShow)
  }, [])

  const active = method !== "mercadopago" ? ALIAS_METHODS[method] : null
  const Icon = METHODS.find((m) => m.id === method)!.icon

  const ars = draft.pack ? prices[draft.pack].ars : draft.monto || 0
  const usd = draft.pack ? prices[draft.pack].usd : 0
  // El precio de lista es el que se paga con Mercado Pago. Transferencia y
  // Binance tienen un descuento (nunca mostramos esto como "recargo de MP").
  const mpTotalArs = mpTotal(ars)
  const descuento = mpTotalArs - ars
  const displayAmount =
    method === "binance"
      ? `USD $${usd.toLocaleString("es-AR")}`
      : method === "mercadopago"
      ? formatARS(mpTotalArs)
      : formatARS(ars)

  const copyValue = async () => {
    if (!active) return
    setPaidWithMethod(method as "transferencia" | "binance")
    try {
      await navigator.clipboard.writeText(active.value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const el = document.createElement("textarea")
      el.value = active.value
      document.body.appendChild(el)
      el.select()
      try {
        document.execCommand("copy")
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        /* noop */
      }
      document.body.removeChild(el)
    }
  }

  const switchMethod = (next: Method) => {
    if (next === method) return
    setMethod(next)
    setCopied(false)
    setMpError(null)
  }

  // Reintenta 3 veces (sin bloquear al cliente, que ya siguió con onPaid())
  // porque si esto termina fallando del todo, un pago de Binance sin
  // etiquetar se factura por default como si fuera transferencia — algo que
  // el negocio pidió explícitamente que nunca pase.
  const tagPaymentMethodWithRetry = async (key: string, metodo: "transferencia" | "binance") => {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt))
      try {
        const res = await fetch("/api/tag-payment-method", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idempotencyKey: key, metodo }),
        })
        if (res.ok) return
      } catch {
        // reintenta
      }
    }
  }

  // Transferencia y Binance comparten el mismo flujo de "subir comprobante"
  // hacia el Apps Script, que no guarda en ningún lado cuál de los dos fue.
  // Se etiqueta acá aparte (del lado nuestro) para que cuando el admin
  // apriete "Generar factura" a mano, el sistema sepa saltear los pagos de
  // Binance. Es "best effort": si las 3 reintentos fallan, queda etiquetada
  // como transferencia por default (ver getPaymentMethod en
  // netlify/functions/lib/facturacion.ts) — factura de más antes que perder
  // silenciosamente una factura real.
  const handlePaidClick = () => {
    const metodoReal = paidWithMethod ?? method
    if (metodoReal === "transferencia" || metodoReal === "binance") {
      tagPaymentMethodWithRetry(idempotencyKey, metodoReal).catch(() => {})
    }
    onPaid()
  }

  const payWithMercadoPago = async () => {
    setMpError(null)
    setMpLoading(true)

    // La reserva NO se crea acá — recién se crea (y recién ahí se avisa a
    // Discord) cuando Mercado Pago confirma el pago, igual que transferencia
    // no reserva nada hasta que se sube el comprobante. Solo guardamos el
    // draft localmente para poder recuperar el estado del chat al volver del
    // checkout de Mercado Pago.
    const draftWithKey = { ...draft, idempotencyKey }
    saveDraft(draftWithKey, "payment")

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const res = await fetch("/api/mp-create-preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pack: draft.pack,
          nombre: draft.nombre,
          whatsapp: draft.whatsapp,
          discord: draft.discord,
          turno: draft.turno,
          idempotencyKey,
        }),
        signal: controller.signal,
      })
      const data = await res.json()
      if (!data?.ok || !data.init_point) throw new Error("no_init_point")
      window.location.href = data.init_point
    } catch (err) {
      setMpLoading(false)
      const timedOut = err instanceof Error && err.name === "AbortError"
      setMpError(
        timedOut
          ? "Mercado Pago tardó demasiado en responder. Intentá de nuevo."
          : "No se pudo conectar con Mercado Pago. Intentá de nuevo.",
      )
    } finally {
      clearTimeout(timer)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-2 rounded-2xl border border-brand-900/60 bg-gradient-to-br from-brand-950/60 to-black/40 p-4"
    >
      <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-brand-300 mb-3">
        <Icon className="w-3.5 h-3.5" /> Forma de pago
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-black/40 border border-brand-900/60 mb-4">
        {METHODS.map((m) => {
          const MIcon = m.icon
          const isActive = m.id === method
          return (
            <button
              key={m.id}
              onClick={() => switchMethod(m.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-[11px] font-semibold transition ${
                isActive
                  ? "bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-glow-red"
                  : "text-white/60 hover:text-white hover:bg-white/5"
              }`}
            >
              <MIcon className="w-3.5 h-3.5" />
              {m.label}
            </button>
          )
        })}
      </div>

      <div className="text-center mb-4">
        <div className="text-xs text-white/50">
          {method === "binance"
            ? "Monto a enviar (USDT)"
            : method === "mercadopago"
            ? "Total a pagar"
            : "Monto a transferir"}
        </div>
        <div className="font-display font-black text-3xl text-gradient-red">
          {displayAmount}
        </div>
        {method === "transferencia" && (
          <div className="text-[11px] text-green-400 mt-1 font-semibold">
            Ahorrás {formatARS(descuento)} pagando por transferencia
          </div>
        )}
        {method === "binance" && (
          <div className="text-[11px] text-green-400 mt-1 font-semibold">
            Precio con descuento por pagar en USDT
          </div>
        )}
      </div>

      {method === "mercadopago" ? (
        <>
          {mpError && (
            <p className="mb-3 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              {mpError}
            </p>
          )}
          <p className="text-xs text-white/50 leading-relaxed">
            Te vamos a redirigir a Mercado Pago para pagar con tarjeta o dinero en cuenta.
            La reserva se confirma automáticamente apenas se acredita el pago.
          </p>
        </>
      ) : (
        <>
          <button
            onClick={copyValue}
            className="w-full group flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-black/40 border border-brand-700/50 hover:border-brand-500 transition"
          >
            <div className="text-left min-w-0">
              <div className="text-[10px] text-white/40 font-mono uppercase">
                {active!.fieldLabel}
              </div>
              <div className="font-mono text-white text-base truncate">
                {active!.value}
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-brand-300 group-hover:text-brand-200 font-mono uppercase shrink-0">
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" /> Copiado
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" /> Copiar
                </>
              )}
            </div>
          </button>

          <p className="mt-3 text-xs text-white/50 leading-relaxed">{active!.helper}</p>
        </>
      )}

      <div className="mt-4 flex gap-2">
        <button
          onClick={onBack}
          className="px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-sm flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Volver
        </button>
        {method === "mercadopago" ? (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={payWithMercadoPago}
            disabled={mpLoading}
            className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-blue-700 hover:from-blue-400 hover:to-blue-600 disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-lg shadow-blue-900/40"
          >
            {mpLoading ? "Conectando…" : "Pagar con Mercado Pago"}
          </motion.button>
        ) : (
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handlePaidClick}
            className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-green-500 to-green-700 hover:from-green-400 hover:to-green-600 text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-lg shadow-green-900/40"
          >
            Ya pagué, subir comprobante
          </motion.button>
        )}
      </div>
    </motion.div>
  )
}
