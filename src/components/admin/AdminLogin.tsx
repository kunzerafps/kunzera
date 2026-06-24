import { motion } from "framer-motion"
import { Lock, X } from "lucide-react"
import { useState } from "react"

type Props = {
  onLogin: (password: string) => Promise<boolean>
  onClose: () => void
}

export default function AdminLogin({ onLogin, onClose }: Props) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password) return
    setLoading(true)
    setError(null)
    const ok = await onLogin(password)
    setLoading(false)
    if (!ok) {
      setError("Contraseña incorrecta")
      setPassword("")
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90">
      <motion.form
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        onSubmit={handleSubmit}
        className="relative w-full max-w-sm p-6 rounded-2xl border border-brand-900/60 bg-[#0c0204]/95 shadow-2xl shadow-brand-950/70"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center"
          aria-label="Cerrar"
        >
          <X className="w-4 h-4 text-white/60" />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-500 to-brand-800 flex items-center justify-center shadow-glow-red">
            <Lock className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-display font-bold text-white">Panel admin</div>
            <div className="text-xs text-white/50 font-mono">Acceso restringido</div>
          </div>
        </div>

        <label className="text-xs font-mono uppercase tracking-widest text-white/50 block mb-2">
          Contraseña
        </label>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setError(null)
          }}
          placeholder="••••••••••••"
          className={`w-full bg-white/5 border focus:bg-white/10 outline-none rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 transition ${
            error ? "border-red-500/70" : "border-white/10 focus:border-brand-500/60"
          }`}
        />

        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={!password || loading}
          className="mt-6 w-full py-3 rounded-xl bg-gradient-to-r from-brand-500 to-brand-700 hover:from-brand-400 hover:to-brand-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition shadow-glow-red"
        >
          {loading ? "Verificando…" : "Ingresar"}
        </button>
      </motion.form>
    </div>
  )
}
