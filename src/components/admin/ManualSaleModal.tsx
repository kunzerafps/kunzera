import { AnimatePresence, motion } from "framer-motion"
import { AlertTriangle, Check, CheckCircle2, Copy, Loader2, MessageCircleHeart, X } from "lucide-react"
import { useState } from "react"
import { createPortal } from "react-dom"
import type { Pack } from "../../types/order"
import { PACK_LIST } from "../../lib/packs"
import { getAdminToken } from "../../lib/storage"

type Props = {
  open: boolean
  onClose: () => void
  // Se llama después de una carga exitosa — el panel lo usa para refrescar
  // la lista "Ventas por WhatsApp".
  onSaved?: () => void
}

type SavedInfo = {
  id: string
  metaStatus: "ok" | "error"
  duplicate: boolean
}

// Misma validación laxa que el backend (capi-venta-manual.mts): "algo@algo.algo".
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Argentina es UTC-3 fijo — usar la fecha UTC cruda hace que, entre las
// 21:00 y 23:59 hora local, el default quede precargado con el día
// siguiente. Restar 3hs antes de cortar la fecha lo evita.
function todayInArgentina(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// Carga a mano ventas cerradas 100% por WhatsApp que nunca pasaron por el
// sitio (sin reserva, sin comprobante). Hace dos cosas: le avisa a Meta que
// la venta existió (capi-venta-manual.mts la manda como conversión por
// mensajería, con email + país para que el cruce con el anuncio sea fuerte)
// y la guarda en el registro propio del panel, con un ID que el admin puede
// copiar. A propósito NO toca el Sheet de reservas ni Apps Script.
export default function ManualSaleModal({ open, onClose, onSaved }: Props) {
  const [nombre, setNombre] = useState("")
  const [whatsapp, setWhatsapp] = useState("")
  const [email, setEmail] = useState("")
  const [monto, setMonto] = useState("")
  const [pack, setPack] = useState<Pack | "">("")
  const [campania, setCampania] = useState("")
  const [fecha, setFecha] = useState(() => todayInArgentina())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<SavedInfo | null>(null)
  const [copied, setCopied] = useState(false)

  if (typeof document === "undefined") return null

  const reset = () => {
    setNombre("")
    setWhatsapp("")
    setEmail("")
    setMonto("")
    setPack("")
    setCampania("")
    setFecha(todayInArgentina())
    setLoading(false)
    setError(null)
    setSaved(null)
    setCopied(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const copyId = async () => {
    if (!saved) return
    try {
      await navigator.clipboard.writeText(saved.id)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard bloqueado (permisos / http) — el ID igual está a la vista
    }
  }

  const submit = async () => {
    setError(null)
    const montoNum = Number(monto)
    if (!nombre.trim() || !whatsapp.trim() || !montoNum || montoNum <= 0) {
      setError("Completá nombre, WhatsApp y un monto válido")
      return
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError("Poné un email válido — Meta lo necesita para cruzar la venta con el anuncio")
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
          email: email.trim(),
          monto: montoNum,
          pack: pack || undefined,
          campania: campania.trim() || undefined,
          fecha,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        id?: string
        metaStatus?: "ok" | "error"
        duplicate?: boolean
      }
      if (!data.ok) {
        const mensajes: Record<string, string> = {
          unauthorized: "Token admin inválido",
          missing_field: "Faltan datos o el WhatsApp es muy corto",
          email_invalido: "El email no es válido",
          fecha_invalida: "La fecha ingresada no es válida",
          fecha_futura: "La fecha no puede ser futura",
          fecha_muy_vieja: "La fecha no puede ser de hace más de 7 días — Meta rechaza eventos más viejos",
          rate_limited: "Demasiadas cargas en poco tiempo, esperá un momento",
          no_se_guardo:
            "El aviso a Meta salió, pero la venta no se pudo guardar en el registro. Avisá que lo revisen.",
        }
        setError(
          (data.error && mensajes[data.error]) ||
            "No se pudo cargar la venta: " + (data.error || `HTTP ${res.status}`),
        )
        return
      }
      setSaved({
        id: data.id || "—",
        metaStatus: data.metaStatus === "error" ? "error" : "ok",
        duplicate: !!data.duplicate,
      })
      onSaved?.()
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
                {saved ? (
                  <div className="flex flex-col items-center gap-3 py-4 text-center">
                    {saved.metaStatus === "ok" ? (
                      <>
                        <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                        <p className="text-white/80 text-sm">
                          {saved.duplicate
                            ? "Esta venta ya estaba cargada. No se duplicó."
                            : "Venta registrada y avisada a Meta."}
                        </p>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-10 h-10 text-amber-400" />
                        <p className="text-white/80 text-sm">
                          Venta <span className="text-white">registrada</span>, pero el aviso a Meta
                          falló. Reintentá desde <span className="text-white">“Ventas WA”</span> en el
                          panel.
                        </p>
                      </>
                    )}

                    <div className="w-full mt-1">
                      <span className="block text-[11px] uppercase tracking-wide text-white/40 mb-1">
                        Número de orden
                      </span>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white font-mono select-all">
                          {saved.id}
                        </code>
                        <button
                          onClick={copyId}
                          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-xs transition"
                        >
                          {copied ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" /> Copiado
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" /> Copiar
                            </>
                          )}
                        </button>
                      </div>
                    </div>

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
                      Para ventas que cerraste por WhatsApp y que <span className="text-white/70">nunca
                      pasaron por el sitio</span>. Si la persona sí reservó en la web, marcá esa
                      reserva como pagada — no la cargues acá.
                    </p>
                    <Field label="Nombre">
                      <input
                        value={nombre}
                        onChange={(e) => setNombre(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-brand-500/60 transition"
                        placeholder="Nombre del cliente"
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="WhatsApp">
                        <input
                          value={whatsapp}
                          onChange={(e) => setWhatsapp(e.target.value)}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-brand-500/60 transition"
                          placeholder="+54 9 11 ..."
                        />
                      </Field>
                      <Field label="Email">
                        <input
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          type="email"
                          inputMode="email"
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-brand-500/60 transition"
                          placeholder="cliente@mail.com"
                        />
                      </Field>
                    </div>
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
                    <div className="grid grid-cols-2 gap-3">
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
                      <Field label="Campaña (opcional)">
                        <input
                          value={campania}
                          onChange={(e) => setCampania(e.target.value)}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-brand-500/60 transition"
                          placeholder="ej: Reel PC lenta"
                        />
                      </Field>
                    </div>

                    {error && <p className="text-red-400 text-xs">{error}</p>}

                    <button
                      onClick={submit}
                      disabled={loading}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 hover:brightness-110 text-white text-sm font-semibold transition disabled:opacity-50"
                    >
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Registrar y avisar a Meta
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
