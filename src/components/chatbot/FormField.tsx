import { motion } from "framer-motion"
import { ArrowRight } from "lucide-react"
import { useState } from "react"

type Props = {
  label: string
  placeholder: string
  type?: "text" | "tel" | "email"
  autoComplete?: string
  initialValue?: string
  onSubmit: (value: string) => string | null
  // Si viene, el campo es opcional: se dibuja un botón para seguir sin
  // completarlo. Lo usa el paso del mail — pedirlo en la mitad de una compra
  // sin salida hace abandonar, y el objetivo es sumar cobertura, no frenar
  // ventas.
  skipLabel?: string
  onSkip?: () => void
}

export default function FormField({
  label,
  placeholder,
  type = "text",
  autoComplete,
  initialValue = "",
  onSubmit,
  skipLabel,
  onSkip,
}: Props) {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const err = onSubmit(value)
    if (err) setError(err)
  }

  return (
    <motion.form
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      onSubmit={handleSubmit}
      className="mt-2 flex flex-col gap-2"
    >
      <label className="text-xs font-mono uppercase tracking-widest text-white/50">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          autoFocus
          type={type}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            if (touched) setError(null)
          }}
          onBlur={() => setTouched(true)}
          placeholder={placeholder}
          className={`flex-1 bg-white/5 border focus:bg-white/10 outline-none rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 transition ${
            error ? "border-red-500/70" : "border-white/10 focus:border-brand-500/60"
          }`}
        />
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          type="submit"
          disabled={!value.trim()}
          className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-500 to-brand-800 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center justify-center shadow-glow-red"
          aria-label="Continuar"
        >
          <ArrowRight className="w-4 h-4 text-white" />
        </motion.button>
      </div>
      {error && (
        <motion.p
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="text-xs text-red-400 pl-1"
        >
          {error}
        </motion.p>
      )}
      {skipLabel && onSkip && (
        <button
          type="button"
          onClick={onSkip}
          className="self-start text-xs text-white/40 hover:text-white/70 underline underline-offset-4 decoration-white/20 transition py-1"
        >
          {skipLabel}
        </button>
      )}
    </motion.form>
  )
}
