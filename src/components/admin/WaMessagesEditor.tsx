import { motion } from "framer-motion"
import { Ban, Check, Eye, EyeOff, Loader2, Plus, RotateCcw, Save, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import {
  applyTemplate,
  DEFAULT_SITE_CONFIG,
  fetchSiteConfig,
  saveSiteConfig,
  type BlockedWindow,
  type SiteConfig,
} from "../../lib/waMessages"
import { sha256 } from "../../lib/crypto"
import { formatDateAR } from "../../lib/formatters"
import { TIMEZONE } from "../../lib/constants"
import type { Pack } from "../../types/order"

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; error: string }

const PLACEHOLDERS = [
  { key: "nombre", desc: "Primer nombre del cliente" },
  { key: "pack", desc: "Platino o Diamante" },
  { key: "turno", desc: 'Ej: "Hoy 22:00"' },
]

const PREVIEW_VARS: Record<string, string> = {
  nombre: "Juan",
  pack: "Platino",
  turno: "Hoy 22:00",
}

const MAX_LEN = 1000
const MIN_PASSWORD = 6

type PriceField = `${Pack}-${"ars" | "usd"}`

export default function WaMessagesEditor() {
  const [template, setTemplate] = useState("")
  const [prices, setPrices] = useState(DEFAULT_SITE_CONFIG.prices)
  const [priceText, setPriceText] = useState<Record<PriceField, string>>({
    "platino-ars": String(DEFAULT_SITE_CONFIG.prices.platino.ars),
    "platino-usd": String(DEFAULT_SITE_CONFIG.prices.platino.usd),
    "diamante-ars": String(DEFAULT_SITE_CONFIG.prices.diamante.ars),
    "diamante-usd": String(DEFAULT_SITE_CONFIG.prices.diamante.usd),
  })
  const [savedHash, setSavedHash] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [blockedWindows, setBlockedWindows] = useState<BlockedWindow[]>([])
  const [campaigns, setCampaigns] = useState<string[]>([])
  const [newCampaign, setNewCampaign] = useState("")
  const [windowStart, setWindowStart] = useState("")
  const [windowEnd, setWindowEnd] = useState("")
  const [windowLabel, setWindowLabel] = useState("")
  const [windowError, setWindowError] = useState("")
  const [loading, setLoading] = useState(true)
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" })
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let cancelled = false
    fetchSiteConfig(true).then((c) => {
      if (cancelled) return
      setTemplate(c.clientTemplate)
      setPrices(c.prices)
      setPriceText({
        "platino-ars": String(c.prices.platino.ars),
        "platino-usd": String(c.prices.platino.usd),
        "diamante-ars": String(c.prices.diamante.ars),
        "diamante-usd": String(c.prices.diamante.usd),
      })
      setSavedHash(c.adminPasswordHash)
      setBlockedWindows(c.blockedWindows)
      setCampaigns(c.campaigns)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const trimmed = template.trim()
  const tooLong = template.length > MAX_LEN

  const parsedPrices: SiteConfig["prices"] = {
    platino: {
      ars: parsePrice(priceText["platino-ars"], prices.platino.ars),
      usd: parsePrice(priceText["platino-usd"], prices.platino.usd),
    },
    diamante: {
      ars: parsePrice(priceText["diamante-ars"], prices.diamante.ars),
      usd: parsePrice(priceText["diamante-usd"], prices.diamante.usd),
    },
  }

  const anyPriceInvalid = (
    ["platino-ars", "platino-usd", "diamante-ars", "diamante-usd"] as PriceField[]
  ).some((k) => !isValidPrice(priceText[k]))

  const passwordTouched = newPassword.length > 0 || confirmPassword.length > 0
  const passwordValid =
    !passwordTouched ||
    (newPassword.length >= MIN_PASSWORD && newPassword === confirmPassword)
  const passwordMismatch =
    passwordTouched && newPassword !== confirmPassword
  const passwordTooShort =
    passwordTouched && newPassword.length > 0 && newPassword.length < MIN_PASSWORD

  const dirty =
    trimmed !== DEFAULT_SITE_CONFIG.clientTemplate ||
    JSON.stringify(parsedPrices) !== JSON.stringify(DEFAULT_SITE_CONFIG.prices) ||
    passwordTouched ||
    savedHash !== "" ||
    blockedWindows.length > 0 ||
    campaigns.length > 0

  const onSave = async () => {
    if (!trimmed || tooLong || anyPriceInvalid || !passwordValid) return
    setSaveState({ kind: "saving" })
    const nextHash = passwordTouched ? await sha256(newPassword) : savedHash
    const result = await saveSiteConfig({
      clientTemplate: trimmed,
      prices: parsedPrices,
      adminPasswordHash: nextHash,
      blockedWindows,
      campaigns,
    })
    if (result.ok) {
      setPrices(parsedPrices)
      setSavedHash(nextHash)
      setNewPassword("")
      setConfirmPassword("")
      setSaveState({ kind: "saved" })
      setTimeout(
        () => setSaveState((s) => (s.kind === "saved" ? { kind: "idle" } : s)),
        2500,
      )
    } else {
      setSaveState({ kind: "error", error: result.error })
    }
  }

  const onAddWindow = () => {
    const start = arInputToIso(windowStart)
    const end = arInputToIso(windowEnd)
    if (!start || !end) {
      setWindowError("Ingresá fecha y hora de inicio y fin.")
      return
    }
    if (new Date(end).getTime() <= new Date(start).getTime()) {
      setWindowError("El fin debe ser posterior al inicio.")
      return
    }
    const win: BlockedWindow = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      start,
      end,
    }
    const label = windowLabel.trim()
    if (label) win.label = label.slice(0, 80)
    setBlockedWindows((ws) => [...ws, win].sort(byStart))
    setWindowStart("")
    setWindowEnd("")
    setWindowLabel("")
    setWindowError("")
    if (saveState.kind !== "idle") setSaveState({ kind: "idle" })
  }

  const onRemoveWindow = (id: string) => {
    setBlockedWindows((ws) => ws.filter((w) => w.id !== id))
    if (saveState.kind !== "idle") setSaveState({ kind: "idle" })
  }

  const onAddCampaign = () => {
    const c = newCampaign.trim().slice(0, 80)
    if (!c || campaigns.some((x) => x.toLowerCase() === c.toLowerCase())) {
      setNewCampaign("")
      return
    }
    setCampaigns((cs) => [...cs, c])
    setNewCampaign("")
    if (saveState.kind !== "idle") setSaveState({ kind: "idle" })
  }

  const onRemoveCampaign = (c: string) => {
    setCampaigns((cs) => cs.filter((x) => x !== c))
    if (saveState.kind !== "idle") setSaveState({ kind: "idle" })
  }

  const onRestoreTemplate = () => {
    setTemplate(DEFAULT_SITE_CONFIG.clientTemplate)
    setSaveState({ kind: "idle" })
  }

  const onRestorePrices = () => {
    setPriceText({
      "platino-ars": String(DEFAULT_SITE_CONFIG.prices.platino.ars),
      "platino-usd": String(DEFAULT_SITE_CONFIG.prices.platino.usd),
      "diamante-ars": String(DEFAULT_SITE_CONFIG.prices.diamante.ars),
      "diamante-usd": String(DEFAULT_SITE_CONFIG.prices.diamante.usd),
    })
    setSaveState({ kind: "idle" })
  }

  const onRestorePassword = () => {
    setSavedHash("")
    setNewPassword("")
    setConfirmPassword("")
    setSaveState({ kind: "idle" })
  }

  const insertPlaceholder = (key: string) => {
    const ta = textareaRef.current
    if (!ta) {
      setTemplate((t) => `${t}{${key}}`)
      return
    }
    const start = ta.selectionStart ?? template.length
    const end = ta.selectionEnd ?? template.length
    const next = `${template.slice(0, start)}{${key}}${template.slice(end)}`
    setTemplate(next)
    requestAnimationFrame(() => {
      const pos = start + key.length + 2
      ta.focus()
      ta.setSelectionRange(pos, pos)
    })
  }

  const updatePrice = (field: PriceField, value: string) => {
    setPriceText((s) => ({ ...s, [field]: value }))
    if (saveState.kind !== "idle") setSaveState({ kind: "idle" })
  }

  const preview = applyTemplate(template, PREVIEW_VARS)

  if (loading) {
    return (
      <div className="glass-card rounded-2xl p-6 max-w-2xl">
        <div className="flex items-center gap-2 text-white/50 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="glass-card rounded-2xl p-4 md:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display font-bold text-lg text-white mb-1">
              Mensaje al cliente (WhatsApp)
            </h2>
            <p className="text-xs text-white/50">
              Texto que se precarga al abrir el chat de WhatsApp desde el
              detalle de un turno.
            </p>
          </div>
          <button
            onClick={onRestoreTemplate}
            className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 text-[11px] transition"
            title="Restaurar mensaje default"
          >
            <RotateCcw className="w-3 h-3" /> Default
          </button>
        </div>

        <div className="mb-2 flex flex-wrap gap-1.5">
          {PLACEHOLDERS.map((p) => (
            <button
              key={p.key}
              onClick={() => insertPlaceholder(p.key)}
              title={p.desc}
              className="px-2 py-0.5 text-[11px] font-mono rounded-full bg-brand-950/80 border border-brand-700/50 hover:border-brand-500 text-brand-200 transition"
            >
              {`{${p.key}}`}
            </button>
          ))}
        </div>

        <textarea
          ref={textareaRef}
          value={template}
          onChange={(e) => {
            setTemplate(e.target.value)
            if (saveState.kind !== "idle") setSaveState({ kind: "idle" })
          }}
          rows={6}
          maxLength={MAX_LEN}
          className="w-full bg-white/5 border border-white/10 focus:border-brand-500/60 focus:bg-white/10 outline-none rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/30 resize-y font-mono"
          placeholder="¡Hola {nombre}! ..."
        />
        <div className="mt-1 flex items-center justify-between text-[10px] font-mono text-white/40">
          <span>{tooLong ? `Máximo ${MAX_LEN} caracteres` : ""}</span>
          <span className={tooLong ? "text-red-400" : ""}>
            {template.length}/{MAX_LEN}
          </span>
        </div>

        <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-1">
            Vista previa
          </div>
          <div className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">
            {preview || <span className="text-white/30">—</span>}
          </div>
        </div>
      </div>

      <div className="glass-card rounded-2xl p-4 md:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display font-bold text-lg text-white mb-1">
              Precios
            </h2>
            <p className="text-xs text-white/50">
              ARS se cobra por transferencia y se registra en la planilla. USD
              se muestra cuando el cliente paga con Binance Pay (USDT).
            </p>
          </div>
          <button
            onClick={onRestorePrices}
            className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 text-[11px] transition"
            title="Restaurar precios default"
          >
            <RotateCcw className="w-3 h-3" /> Default
          </button>
        </div>

        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] font-mono uppercase tracking-widest text-white/40">
                <th className="text-left py-2 px-2">Pack</th>
                <th className="text-left py-2 px-2">ARS (transferencia)</th>
                <th className="text-left py-2 px-2">USD (Binance)</th>
              </tr>
            </thead>
            <tbody>
              <PriceRow
                label="⚡ Platino"
                arsValue={priceText["platino-ars"]}
                usdValue={priceText["platino-usd"]}
                onArsChange={(v) => updatePrice("platino-ars", v)}
                onUsdChange={(v) => updatePrice("platino-usd", v)}
              />
              <PriceRow
                label="💎 Diamante"
                arsValue={priceText["diamante-ars"]}
                usdValue={priceText["diamante-usd"]}
                onArsChange={(v) => updatePrice("diamante-ars", v)}
                onUsdChange={(v) => updatePrice("diamante-usd", v)}
              />
            </tbody>
          </table>
        </div>
        {anyPriceInvalid && (
          <div className="mt-2 text-xs text-red-400">
            Hay precios inválidos. Usá números mayores o iguales a 0.
          </div>
        )}
      </div>

      <div className="glass-card rounded-2xl p-4 md:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display font-bold text-lg text-white mb-1">
              Contraseña admin
            </h2>
            <p className="text-xs text-white/50">
              Cambiá la contraseña de acceso al panel. Dejá los campos vacíos
              para mantener la actual. Mínimo {MIN_PASSWORD} caracteres.
              {savedHash
                ? " Hay una contraseña personalizada activa."
                : " Está usando la contraseña por defecto."}
            </p>
          </div>
          <button
            onClick={onRestorePassword}
            disabled={!savedHash && !newPassword && !confirmPassword}
            className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 text-[11px] transition disabled:opacity-40"
            title="Volver a la contraseña por defecto"
          >
            <RotateCcw className="w-3 h-3" /> Default
          </button>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-white/40 block mb-1">
              Nueva contraseña
            </label>
            <div
              className={`flex items-center gap-1 bg-white/5 border rounded-xl px-3 ${
                passwordTooShort
                  ? "border-red-500/60"
                  : "border-white/10 focus-within:border-brand-500/60"
              }`}
            >
              <input
                type={showPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value)
                  if (saveState.kind !== "idle") setSaveState({ kind: "idle" })
                }}
                placeholder="••••••••"
                className="w-full bg-transparent outline-none py-2 text-sm text-white placeholder:text-white/30"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="text-white/40 hover:text-white/70 p-1"
                aria-label={showPassword ? "Ocultar" : "Mostrar"}
              >
                {showPassword ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-white/40 block mb-1">
              Confirmar
            </label>
            <input
              type={showPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value)
                if (saveState.kind !== "idle") setSaveState({ kind: "idle" })
              }}
              placeholder="••••••••"
              className={`w-full bg-white/5 border focus:bg-white/10 outline-none rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/30 transition ${
                passwordMismatch
                  ? "border-red-500/60"
                  : "border-white/10 focus:border-brand-500/60"
              }`}
              autoComplete="new-password"
            />
          </div>
        </div>
        {(passwordTooShort || passwordMismatch) && (
          <div className="mt-2 text-xs text-red-400">
            {passwordTooShort
              ? `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`
              : "Las contraseñas no coinciden."}
          </div>
        )}
      </div>

      <div className="glass-card rounded-2xl p-4 md:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display font-bold text-lg text-white mb-1">
              Ventanas de descanso
            </h2>
            <p className="text-xs text-white/50">
              Rangos de fecha/hora en los que no se ofrecerán turnos. Se usa la
              zona horaria de Argentina ({TIMEZONE.split("/")[1].replace("_", " ")}).
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-white/40 block mb-1">
              Desde
            </label>
            <input
              type="datetime-local"
              value={windowStart}
              onChange={(e) => {
                setWindowStart(e.target.value)
                setWindowError("")
              }}
              className="w-full bg-white/5 border border-white/10 focus:border-brand-500/60 focus:bg-white/10 outline-none rounded-xl px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="text-[10px] font-mono uppercase tracking-widest text-white/40 block mb-1">
              Hasta
            </label>
            <input
              type="datetime-local"
              value={windowEnd}
              min={windowStart || undefined}
              onChange={(e) => {
                setWindowEnd(e.target.value)
                setWindowError("")
              }}
              className="w-full bg-white/5 border border-white/10 focus:border-brand-500/60 focus:bg-white/10 outline-none rounded-xl px-3 py-2 text-sm text-white"
            />
          </div>
        </div>
        <div className="mb-3">
          <label className="text-[10px] font-mono uppercase tracking-widest text-white/40 block mb-1">
            Motivo (opcional)
          </label>
          <input
            type="text"
            value={windowLabel}
            maxLength={80}
            placeholder="Ej: Viaje / Feriado"
            onChange={(e) => setWindowLabel(e.target.value)}
            className="w-full bg-white/5 border border-white/10 focus:border-brand-500/60 focus:bg-white/10 outline-none rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/30"
          />
        </div>
        {windowError && (
          <div className="mb-2 text-xs text-red-400">{windowError}</div>
        )}
        <button
          onClick={onAddWindow}
          disabled={!windowStart || !windowEnd}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-4 h-4" /> Agregar ventana
        </button>

        <div className="mt-4 space-y-2">
          {blockedWindows.length === 0 ? (
            <div className="text-[11px] font-mono text-white/30">
              No hay ventanas configuradas.
            </div>
          ) : (
            blockedWindows.map((w) => (
              <div
                key={w.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-black/30 p-3"
              >
                <div className="flex items-start gap-2 min-w-0">
                  <Ban className="w-4 h-4 text-brand-300 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-sm text-white">
                      {formatDateAR(w.start)}{" "}
                      <span className="text-white/40">→</span>{" "}
                      {formatDateAR(w.end)}
                    </div>
                    {w.label && (
                      <div className="text-[11px] text-white/50 truncate">
                        {w.label}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => onRemoveWindow(w.id)}
                  className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 hover:bg-red-500/20 border border-white/10 hover:border-red-500/40 text-white/60 hover:text-red-300 text-[11px] transition"
                  aria-label="Eliminar ventana"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 md:p-5">
        <h3 className="text-sm font-semibold text-white mb-1">Campañas de Meta</h3>
        <p className="text-[11px] text-white/40 leading-relaxed mb-3">
          Los nombres que pongas acá aparecen como menú en el campo “Campaña” de Venta manual, para
          no escribirlos a mano. Poné el mismo nombre que usás en el Administrador de anuncios.
        </p>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={newCampaign}
            maxLength={80}
            placeholder="Ej: Reel PC lenta"
            onChange={(e) => setNewCampaign(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                onAddCampaign()
              }
            }}
            className="flex-1 bg-white/5 border border-white/10 focus:border-brand-500/60 focus:bg-white/10 outline-none rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/30"
          />
          <button
            onClick={onAddCampaign}
            disabled={!newCampaign.trim()}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-sm transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            <Plus className="w-4 h-4" /> Agregar
          </button>
        </div>
        {campaigns.length === 0 ? (
          <div className="text-[11px] font-mono text-white/30">
            Sin campañas. El campo “Campaña” sigue siendo de texto libre.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {campaigns.map((c) => (
              <span
                key={c}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/30 pl-2.5 pr-1.5 py-1 text-xs text-white/80"
              >
                {c}
                <button
                  onClick={() => onRemoveCampaign(c)}
                  className="inline-flex items-center justify-center w-4 h-4 rounded hover:bg-red-500/20 text-white/40 hover:text-red-300 transition"
                  aria-label={`Eliminar ${c}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={onSave}
          disabled={
            saveState.kind === "saving" ||
            !trimmed ||
            tooLong ||
            anyPriceInvalid ||
            !passwordValid
          }
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saveState.kind === "saving" ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Guardando…
            </>
          ) : saveState.kind === "saved" ? (
            <>
              <Check className="w-4 h-4" /> Guardado
            </>
          ) : (
            <>
              <Save className="w-4 h-4" /> Guardar todo
            </>
          )}
        </motion.button>

        {!dirty && saveState.kind === "idle" && (
          <span className="text-[11px] font-mono text-white/30">
            Sin cambios pendientes
          </span>
        )}
      </div>

      {saveState.kind === "error" && (
        <div className="text-xs text-red-400">
          No se pudo guardar: {saveState.error}. Si estás corriendo localmente
          con <code className="font-mono">npm run dev</code>, el guardado solo
          funciona en el sitio deployado.
        </div>
      )}

      <p className="text-[11px] text-white/30 leading-relaxed">
        Los visitantes pueden ver hasta 5 minutos en caché los valores
        anteriores; el sitio refresca al cargar.
      </p>
    </div>
  )
}

function PriceRow({
  label,
  arsValue,
  usdValue,
  onArsChange,
  onUsdChange,
}: {
  label: string
  arsValue: string
  usdValue: string
  onArsChange: (v: string) => void
  onUsdChange: (v: string) => void
}) {
  return (
    <tr className="border-t border-white/5">
      <td className="py-3 px-2 text-white font-medium whitespace-nowrap">
        {label}
      </td>
      <td className="py-2 px-2">
        <PriceInput value={arsValue} onChange={onArsChange} prefix="$" />
      </td>
      <td className="py-2 px-2">
        <PriceInput value={usdValue} onChange={onUsdChange} prefix="USD" />
      </td>
    </tr>
  )
}

function PriceInput({
  value,
  onChange,
  prefix,
}: {
  value: string
  onChange: (v: string) => void
  prefix: string
}) {
  const invalid = !isValidPrice(value)
  return (
    <div
      className={`flex items-center gap-1 bg-white/5 border rounded-lg px-2 ${
        invalid ? "border-red-500/60" : "border-white/10 focus-within:border-brand-500/60"
      }`}
    >
      <span className="text-[10px] font-mono text-white/40">{prefix}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent outline-none py-1.5 text-sm font-mono text-white"
      />
    </div>
  )
}

function arInputToIso(s: string): string | null {
  if (!s) return null
  // datetime-local entrega "YYYY-MM-DDTHH:MM" en hora local del usuario.
  // Lo interpretamos como hora AR (UTC-3, sin DST).
  const d = new Date(`${s}:00-03:00`)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function byStart(a: BlockedWindow, b: BlockedWindow): number {
  return new Date(a.start).getTime() - new Date(b.start).getTime()
}

function isValidPrice(s: string): boolean {
  if (s.trim() === "") return false
  const n = Number(s.replace(",", "."))
  return Number.isFinite(n) && n >= 0
}

function parsePrice(s: string, fallback: number): number {
  if (!isValidPrice(s)) return fallback
  return Math.round(Number(s.replace(",", ".")) * 100) / 100
}
