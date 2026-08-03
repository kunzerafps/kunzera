import { AnimatePresence, motion } from "framer-motion"
import {
  Calendar,
  Check,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Loader2,
  MessageSquare,
  Phone,
  Receipt,
  Trash2,
  User,
  X,
} from "lucide-react"
import { useState } from "react"
import { createPortal } from "react-dom"
import type { Order } from "../../types/order"
import { PACKS } from "../../lib/packs"
import { formatARS, formatDateAR, formatSlotLabel } from "../../lib/formatters"
import { deleteOrder, updateOrderStatus } from "../../lib/appsScript"
import { comprobanteUrl } from "../../lib/comprobante"
import { applyTemplate } from "../../lib/waMessages"
import { useSiteConfig } from "../../hooks/useWaMessages"
import { ADMIN_SECRET_TOKEN } from "../../lib/constants"

type Props = {
  order: Order | null
  onClose: () => void
  onStatusChanged?: () => void
  onDeleted?: () => void
}

function isBrokenWhatsapp(value: unknown): boolean {
  const s = String(value ?? "").trim()
  if (!s) return true
  if (s.startsWith("#")) return true // #ERROR!, #REF!, etc.
  return s.replace(/\D/g, "").length < 8
}

function buildWhatsAppLink(order: Order, template: string): string | null {
  if (isBrokenWhatsapp(order.whatsapp)) return null
  const digits = String(order.whatsapp ?? "").replace(/\D/g, "")
  let waFull = digits
  if (!waFull.startsWith("549")) {
    if (waFull.startsWith("54") && waFull.length > 10) waFull = "549" + waFull.slice(2)
    else waFull = "549" + waFull
  }
  const mensaje = applyTemplate(template, {
    nombre: String(order.nombre ?? "").split(" ")[0] || "",
    pack: order.plan === "diamante" ? "Diamante" : "Platino",
    turno: order.turno ? formatSlotLabel(order.turno) : "",
  })
  return `https://wa.me/${waFull}?text=${encodeURIComponent(mensaje)}`
}

export default function OrderDetailModal({ order, onClose, onStatusChanged, onDeleted }: Props) {
  const { clientTemplate } = useSiteConfig()
  if (typeof document === "undefined") return null
  return createPortal(
    <AnimatePresence>
      {order && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[75] bg-black/85"
            onClick={onClose}
          />
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              key="modal"
              initial={{ opacity: 0, scale: 0.94, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 20 }}
              transition={{ type: "spring", damping: 26, stiffness: 260 }}
              className="pointer-events-auto w-full max-w-lg rounded-2xl overflow-hidden border border-brand-900/60 bg-[#0c0204]/95 shadow-2xl shadow-brand-950/70"
              onClick={(e) => e.stopPropagation()}
            >
              <Header order={order} onClose={onClose} />
              <div className="p-5 md:p-6 space-y-4">
                <Section icon={<User className="w-4 h-4" />} label="Cliente">
                  <div className="font-display text-white text-lg">{order.nombre || "—"}</div>
                </Section>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Section icon={<Phone className="w-4 h-4" />} label="WhatsApp" compact>
                    {(() => {
                      const waLink = buildWhatsAppLink(order, clientTemplate)
                      if (!waLink) {
                        return (
                          <span
                            className="font-mono text-red-400/80 text-sm"
                            title="Número inválido o no guardado correctamente"
                          >
                            Número no disponible
                          </span>
                        )
                      }
                      return (
                        <a
                          href={waLink}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-green-300 hover:text-green-200 text-sm inline-flex items-center gap-1"
                          title="Abrir chat con mensaje pre-cargado"
                        >
                          {order.whatsapp}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )
                    })()}
                  </Section>
                  <Section icon={<MessageSquare className="w-4 h-4" />} label="Discord" compact>
                    <span className="font-mono text-white/90 text-sm">{order.discord || "—"}</span>
                  </Section>
                </div>

                <Section icon={<Calendar className="w-4 h-4" />} label="Turno reservado">
                  <div className="flex items-baseline gap-2">
                    <div className="font-display font-bold text-brand-300 text-xl">
                      {order.turno ? formatSlotLabel(order.turno) : "—"}
                    </div>
                    <span className="text-xs text-white/40 font-mono">
                      {order.turno ? formatDateAR(order.turno) : ""}
                    </span>
                  </div>
                </Section>

                <Section icon={<CreditCard className="w-4 h-4" />} label="Pago">
                  <div className="flex items-center gap-2">
                    <span className="font-display font-black text-2xl text-gradient-red">
                      {formatARS(Number(order.monto) || 0)}
                    </span>
                  </div>
                  <div className="mt-2">
                    <ComprobanteRow key={order.idempotencykey || order.timestamp} order={order} />
                  </div>
                </Section>

                <StatusActions
                  key={order.idempotencykey || order.timestamp}
                  order={order}
                  onStatusChanged={onStatusChanged}
                  onDeleted={onDeleted}
                  onClose={onClose}
                />

                <div className="pt-3 border-t border-white/5 flex justify-between text-[11px] font-mono text-white/40">
                  <span>Registrado: {formatDateAR(order.timestamp)}</span>
                  {order.idempotencykey && (
                    <span className="truncate max-w-[150px]" title={String(order.idempotencykey)}>
                      ID: {String(order.idempotencykey).slice(0, 8)}…
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function Header({ order, onClose }: { order: Order; onClose: () => void }) {
  const plan = order.plan as keyof typeof PACKS
  const packInfo = PACKS[plan]
  return (
    <div className="relative p-5 md:p-6 pb-4 bg-gradient-to-br from-brand-700 via-brand-800 to-brand-950 overflow-hidden">
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "linear-gradient(rgba(239,19,19,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(239,19,19,0.15) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
        }}
      />
      <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(255,42,42,0.25) 0%, transparent 65%)" }} />
      <div className="relative flex items-start gap-3">
        <div className="text-4xl leading-none">{packInfo?.emoji || "🎟️"}</div>
        <div className="flex-1">
          <div className="text-[10px] font-mono uppercase tracking-widest text-white/60">
            Reserva · {packInfo?.name || order.plan}
          </div>
          <div className="font-display font-black text-white text-lg leading-tight mt-0.5">
            {packInfo?.tagline || ""}
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4 text-white" />
        </button>
      </div>
    </div>
  )
}

function Section({
  icon,
  label,
  children,
  compact,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
  compact?: boolean
}) {
  return (
    <div className={compact ? "" : ""}>
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-white/40 mb-1.5">
        {icon} {label}
      </div>
      <div>{children}</div>
    </div>
  )
}

function StatusPill({ estado }: { estado?: string }) {
  const s = String(estado || "").toLowerCase()
  if (s === "pendiente") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
        pendiente
      </span>
    )
  }
  if (s === "confirmado" || s === "completado") {
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase bg-green-500/20 text-green-300 border border-green-500/30">
        {s}
      </span>
    )
  }
  return null
}

function ComprobanteRow({ order }: { order: Order }) {
  const [broken, setBroken] = useState(false)
  const [zoom, setZoom] = useState(false)
  const key = order.idempotencykey

  if (key && !broken) {
    const src = comprobanteUrl(String(key))
    return (
      <>
        <button
          type="button"
          onClick={() => setZoom(true)}
          className="block w-full rounded-xl overflow-hidden border border-white/10 hover:border-brand-500/50 transition bg-black/30"
        >
          <img
            src={src}
            alt="comprobante"
            onError={() => setBroken(true)}
            className="max-h-56 w-full object-contain"
          />
        </button>
        <p className="mt-1.5 text-[10px] text-white/40 leading-relaxed">
          Tocá la imagen para ampliar. Corroborá fecha, hora y monto en tu Mercado Pago antes de
          confirmar el turno.
        </p>
        {zoom &&
          createPortal(
            <div
              className="fixed inset-0 z-[95] bg-black/95 flex items-center justify-center p-4"
              onClick={() => setZoom(false)}
            >
              <img
                src={src}
                alt="comprobante ampliado"
                className="max-w-full max-h-full object-contain"
              />
              <button
                onClick={() => setZoom(false)}
                className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center"
                aria-label="Cerrar"
              >
                <X className="w-5 h-5 text-white" />
              </button>
            </div>,
            document.body,
          )}
      </>
    )
  }

  const comprobante = order.comprobante
  if (!comprobante) {
    return <span className="text-xs text-white/40">Sin comprobante</span>
  }
  if (comprobante.startsWith("http")) {
    return (
      <a
        href={comprobante}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-xs text-brand-300 hover:text-brand-200"
      >
        Ver comprobante <ExternalLink className="w-3 h-3" />
      </a>
    )
  }
  return <span className="text-xs text-white/70">{comprobante}</span>
}

function StatusActions({
  order,
  onStatusChanged,
  onDeleted,
  onClose,
}: {
  order: Order
  onStatusChanged?: () => void
  onDeleted?: () => void
  onClose: () => void
}) {
  const [loading, setLoading] = useState<"confirmar" | "atender" | "eliminar" | "factura" | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [factura, setFactura] = useState<{ cae: string; numero: number } | null>(null)
  const current = String(order.estado || "").toLowerCase()
  const isPendiente = current === "pendiente" || current === ""
  const isAtendido = current === "atendido"
  const hasKey = !!order.idempotencykey

  // "Confirmar pago" marca que ya revisaste el comprobante y es real — no
  // dispara nada automático (la facturación es 100% manual, ver botón
  // "Generar factura" más abajo), pero deja registro en el Sheet de que
  // esta reserva ya pasó control antes de "atendido".
  const confirmarPago = async () => {
    if (!hasKey) {
      setError("Esta reserva no tiene ID interno — actualizá el estado manualmente en el Sheet")
      return
    }
    setLoading("confirmar")
    setError(null)
    const result = await updateOrderStatus(String(order.idempotencykey), "confirmado")
    setLoading(null)
    if (!result.ok) {
      setError(
        result.error === "unauthorized"
          ? "Token admin inválido"
          : "No se pudo actualizar: " + result.error,
      )
      return
    }
    onStatusChanged?.()
    onClose()
  }

  const markAsAtendido = async () => {
    if (!hasKey) {
      setError("Esta reserva no tiene ID interno — actualizá el estado manualmente en el Sheet")
      return
    }
    setLoading("atender")
    setError(null)
    const result = await updateOrderStatus(String(order.idempotencykey), "atendido")
    setLoading(null)
    if (!result.ok) {
      setError(
        result.error === "unauthorized"
          ? "Token admin inválido"
          : "No se pudo actualizar: " + result.error,
      )
      return
    }
    onStatusChanged?.()
    onClose()
  }

  const doDelete = async () => {
    if (!hasKey) {
      setError("Esta reserva no tiene ID interno — eliminala manualmente en el Sheet")
      return
    }
    setLoading("eliminar")
    setError(null)
    const result = await deleteOrder(String(order.idempotencykey))
    setLoading(null)
    if (!result.ok) {
      setError(
        result.error === "unauthorized"
          ? "Token admin inválido"
          : result.error === "unknown_action"
          ? "El Apps Script no tiene el endpoint deleteOrder todavía"
          : "No se pudo eliminar: " + result.error,
      )
      return
    }
    onDeleted?.()
    setConfirmDelete(false)
    onClose()
  }

  // Único disparador de facturación en todo el sitio: nada se factura solo,
  // ni Mercado Pago ni transferencia — el admin decide reserva por reserva,
  // cuando la atiende. El backend (generar-factura.mts → invoiceOrderNow)
  // es idempotente: si esta reserva ya se facturó (por ejemplo, doble click,
  // o volver a abrir el detalle), devuelve el mismo CAE en vez de generar
  // una segunda factura.
  const generarFactura = async () => {
    if (!hasKey) {
      setError("Esta reserva no tiene ID interno — no se puede facturar")
      return
    }
    setLoading("factura")
    setError(null)
    let result: { ok: true; cae: string; numero: number; already: boolean } | { ok: false; error: string }
    try {
      const res = await fetch("/api/generar-factura", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: ADMIN_SECRET_TOKEN,
          idempotencyKey: String(order.idempotencykey),
          nombre: order.nombre,
          plan: order.plan,
          monto: order.monto,
          turno: order.turno,
        }),
      })
      result = await res.json()
    } catch {
      result = { ok: false, error: "network" }
    }
    setLoading(null)
    if (!result.ok) {
      const messages: Record<string, string> = {
        unauthorized: "Token admin inválido",
        missing_field: "Faltan datos de la reserva para facturar",
        binance_no_facturable: "Este pago fue por Binance — no se factura",
        not_configured: "La facturación electrónica todavía no está configurada",
        ya_se_esta_facturando: "Ya se está generando esta factura, esperá un momento y volvé a intentar",
        network: "No se pudo conectar con el servidor",
      }
      setError(messages[result.error] || "No se pudo facturar: " + result.error)
      return
    }
    setFactura({ cae: result.cae, numero: result.numero })
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Generar factura: único disparador de facturación de todo el sitio,
          100% manual — no depende del estado de la reserva, el admin decide
          cuándo. Si ya se facturó antes, el backend devuelve el mismo CAE
          en vez de duplicar. */}
      {hasKey &&
        (factura ? (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-violet-500/10 border border-violet-500/30 text-violet-300 text-sm">
            <Receipt className="w-4 h-4 shrink-0" />
            <span>
              Facturada — CAE {factura.cae} (Nº {factura.numero})
            </span>
          </div>
        ) : (
          <motion.button
            whileHover={{ scale: !loading ? 1.01 : 1 }}
            whileTap={{ scale: !loading ? 0.99 : 1 }}
            onClick={generarFactura}
            disabled={!!loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-violet-700 hover:from-violet-400 hover:to-violet-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition shadow-lg shadow-violet-900/40"
          >
            {loading === "factura" ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Facturando…
              </>
            ) : (
              <>
                <Receipt className="w-4 h-4" /> Generar factura
              </>
            )}
          </motion.button>
        ))}

      {/* Confirmar pago: deja constancia de que revisaste el comprobante.
          Solo aparece mientras sigue "pendiente" — una vez confirmada (o
          atendida) desaparece, no hace falta tocarla de nuevo. */}
      {isPendiente && !confirmDelete && (
        <motion.button
          whileHover={{ scale: hasKey && !loading ? 1.01 : 1 }}
          whileTap={{ scale: hasKey && !loading ? 0.99 : 1 }}
          onClick={confirmarPago}
          disabled={!!loading || !hasKey}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-blue-700 hover:from-blue-400 hover:to-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition shadow-lg shadow-blue-900/40"
        >
          {loading === "confirmar" ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Actualizando…
            </>
          ) : (
            <>
              <Check className="w-4 h-4" /> Confirmar pago
            </>
          )}
        </motion.button>
      )}

      {/* Botón principal de atender (si no está ya atendido) */}
      {!isAtendido && !confirmDelete && (
        <motion.button
          whileHover={{ scale: hasKey && !loading ? 1.01 : 1 }}
          whileTap={{ scale: hasKey && !loading ? 0.99 : 1 }}
          onClick={markAsAtendido}
          disabled={!!loading || !hasKey}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-green-500 to-green-700 hover:from-green-400 hover:to-green-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition shadow-lg shadow-green-900/40"
        >
          {loading === "atender" ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Actualizando…
            </>
          ) : (
            <>
              <Check className="w-4 h-4" /> Marcar como atendido
            </>
          )}
        </motion.button>
      )}

      {isAtendido && !confirmDelete && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-green-500/10 border border-green-500/30 text-green-300 text-sm">
          <CheckCircle2 className="w-4 h-4" />
          <span>Turno atendido</span>
        </div>
      )}

      {/* Confirmación de delete */}
      {confirmDelete ? (
        <div className="flex flex-col gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30">
          <p className="text-xs text-red-200 leading-relaxed">
            ¿Eliminar este turno del Sheet? Esta acción no se puede deshacer.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              disabled={!!loading}
              className="flex-1 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-xs disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              onClick={doDelete}
              disabled={!!loading}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold disabled:opacity-40"
            >
              {loading === "eliminar" ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" /> Eliminando…
                </>
              ) : (
                <>
                  <Trash2 className="w-3 h-3" /> Sí, eliminar
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setConfirmDelete(true)}
          disabled={!!loading || !hasKey}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-red-500/15 border border-white/10 hover:border-red-500/40 text-red-300 text-xs font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Trash2 className="w-3.5 h-3.5" /> Eliminar turno
        </button>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
