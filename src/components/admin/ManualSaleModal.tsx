import { AnimatePresence, motion } from "framer-motion"
import { CheckCircle2, Loader2, MessageCircleHeart, X } from "lucide-react"
import { useState } from "react"
import { createPortal } from "react-dom"
import type { Pack } from "../../types/order"
import { PACK_LIST } from "../../lib/packs"
import { getAdminToken } from "../../lib/storage"

type Props = {
  open: boolean
  onClose: () => void
}

// Argentina es UTC-3 fijo — usar la fecha UTC cruda hace que, entre las
// 21:00 y 23:59 hora local, el default quede precargado con el día
// siguiente. Restar 3hs antes de cortar la fecha lo evita.
function todayInArgentina(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// Carga a mano ventas cerradas 100% por WhatsApp que nunca pasaron por el
// sitio (sin reserva, sin comprobante) — el único propósito es avisarle a
// Meta que la venta existió (capi-venta-manual.mts la manda como conversión
// offline). A propósito NO toca el Sheet de reservas ni Apps Script: esto no
// reemplaza ningún registro, solo mejora lo que Meta ve.
export default function ManualSaleModal({ open, onClose }: Props) {
  const [nombre, setNombre] = useState("")
  const [whatsapp, setWhatsapp] = useState("")
  const [monto, setMonto] = useState("")
  const [pack, setPack] = useState<Pack | "">("")
  const [fecha, setFecha] = useState(() => todayInArgentina())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  if (typeof document === "undefined") return null

  const reset = () => {
    setNombre("")
    setWhatsapp("")
    setMonto("")
    setPack("")
    setFecha(todayInArgentina())
    setLoading(false)
    setError(null)
    setSuccess(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const submit = async () => {
    setError(null)
    const montoNum = Number(monto)
    if (!nombre.trim() || !whatsapp.trim() || !montoNum || montoNum <= 0) {
      setError("Completá nombre, WhatsApp y un monto válido")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/capi-venta-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: getAdminToken(),
          nombre: nombre.trim(),
          whatsapp: whatsapp.trim(),
          monto: montoNum,
          pack: pack || undefined,
          fecha,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!data.ok) {
        const mensajes: Record<string, string> = {
          unauthorized: "Token admin inválido",
          missing_field: "Faltan datos o el WhatsApp es muy corto",
          fecha_invalida: "La fecha ingresada no es válida",
          fecha_futura: "La fecha no puede ser futura",
          fecha_muy_vieja: "La fecha no puede ser de hace más de 7 días — Meta rechaza eventos más viejos",
          rate_limited: "Demasiadas cargas en poco tiempo, esperá un momento",
        }
        setError(
          (data.error && mensajes[data.error]) ||
            "No se pudo avisar a Meta: " + (data.error || `HTTP ${res.status}`),
        )
        return
      }
      setSuccess(true)
    } catch (err) {
      setError("Error de red: " + String(err))
    } finally {
      setLoading(false)
    }
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[75] bg-black/85"
            onClick={handleClose}
          />
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              key="modal"
              initial={{ opacity: 0, scale: 0.94, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 20 }}
              transition={{ type: "spring", damping: 26, stiffness: 260 }}
              className="pointer-events-auto w-full max-w-md rounded-2xl overflow-hidden border border-brand-900/60 bg-[#0c0204]/95 shadow-2xl shadow-brand-950/70"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <MessageCircleHeart className="w-4 h-4 text-brand-400" />
                  <h2 className="font-display font-bold text-white text-lg">Venta manual (WhatsApp)</h2>
                </div>
                <button
                  onClick={handleClose}
                  className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition"
                >
                  <X className="w-4 h-4 text-white/70" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                {success ? (
                  <div className="flex flex-col items-center gap-3 py-6 text-center">
                    <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                    <p className="text-white/80 text-sm">
                      Avisado a Meta. Esto no crea ninguna reserva ni fila en el Sheet — solo
                      mejora el tracking de anuncios.
                    </p>
                    <button
                      onClick={reset}
                      className="mt-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-sm transition"
                    >
                      Cargar otra
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="text-white/50 text-xs leading-relaxed">
                      Para ventas que cerraste por WhatsApp y que nunca pasaron por el sitio. No
                      genera reserva ni factura — solo le avisa a Meta que la venta existió.
                    </p>
                    <Field label="Nombre">
                      <input
                        value={nombre}
                        onChange={(e) => setNombre(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-brand-500/60 transition"
                        placeholder="Nombre del cliente"
                      />
                    </Field>
                    <Field label="WhatsApp">
                      <input
                        value={whatsapp}
                        onChange={(e) => setWhatsapp(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-brand-500/60 transition"
                        placeholder="+54 9 11 ..."
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Monto (ARS)">
                        <input
                          value={monto}
                          onChange={(e) => setMonto(e.target.value.replace(/[^\d]/g, ""))}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-brand-500/60 transition"
                          inputMode="numeric"
                          placeholder="50000"
                        />
                      </Field>
                      <Field label="Fecha">
                        <input
                          type="date"
                          value={fecha}
                          onChange={(e) => setFecha(e.target.value)}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-brand-500/60 transition [color-scheme:dark]"
                          max={todayInArgentina()}
                        />
                      </Field>
                    </div>
                    <Field label="Pack (opcional)">
                      <select
                        value={pack}
                        onChange={(e) => setPack(e.target.value as Pack | "")}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-brand-500/60 transition"
                      >
                        <option value="">—</option>
                        {PACK_LIST.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </Field>

                    {error && <p className="text-red-400 text-xs">{error}</p>}

                    <button
                      onClick={submit}
                      disabled={loading}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 hover:brightness-110 text-white text-sm font-semibold transition disabled:opacity-50"
                    >
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Avisar a Meta
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide text-white/40 mb-1">{label}</span>
      {children}
    </label>
  )
}
