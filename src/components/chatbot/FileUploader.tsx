import { motion } from "framer-motion"
import { FileText, Image as ImageIcon, Upload, X } from "lucide-react"
import { useRef, useState } from "react"
import { fileToBase64, validateFile } from "../../lib/validators"
import { formatBytes } from "../../lib/formatters"
import type { OrderDraft } from "../../types/order"

type Props = {
  onFile: (file: NonNullable<OrderDraft["file"]>) => void
}

export default function FileUploader({ onFile }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ name: string; size: number; url?: string; kind: "image" | "pdf" } | null>(
    null,
  )
  const [dragging, setDragging] = useState(false)
  const [processing, setProcessing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    setError(null)
    const err = validateFile(file)
    if (err) {
      setError(err)
      return
    }
    setProcessing(true)
    try {
      const base64 = await fileToBase64(file)
      const kind: "image" | "pdf" = file.type === "application/pdf" ? "pdf" : "image"
      const url = kind === "image" ? URL.createObjectURL(file) : undefined
      setPreview({ name: file.name, size: file.size, url, kind })
      onFile({ base64, mime: file.type, name: file.name, size: file.size })
    } catch (e) {
      setError("No pude leer el archivo, probá con otro")
    } finally {
      setProcessing(false)
    }
  }

  const reset = () => {
    setPreview(null)
    if (inputRef.current) inputRef.current.value = ""
  }

  if (preview) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-2 rounded-2xl border border-green-700/40 bg-green-950/20 p-3 flex items-center gap-3"
      >
        {preview.kind === "image" && preview.url ? (
          <img
            src={preview.url}
            alt="comprobante"
            className="w-14 h-14 rounded-lg object-cover border border-white/10"
          />
        ) : (
          <div className="w-14 h-14 rounded-lg bg-brand-950 border border-brand-700/50 flex items-center justify-center">
            <FileText className="w-6 h-6 text-brand-300" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm text-white truncate">{preview.name}</div>
          <div className="text-xs text-white/50">{formatBytes(preview.size)} · enviando…</div>
        </div>
        <button
          onClick={reset}
          className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center"
          aria-label="Quitar archivo"
        >
          <X className="w-4 h-4 text-white/60" />
        </button>
      </motion.div>
    )
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-2">
      <label
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const f = e.dataTransfer.files?.[0]
          if (f) handleFile(f)
        }}
        className={`flex flex-col items-center justify-center gap-2 p-6 rounded-2xl border-2 border-dashed cursor-pointer transition ${
          dragging
            ? "border-brand-500 bg-brand-500/10"
            : "border-brand-900/60 bg-black/30 hover:border-brand-600/80 hover:bg-black/50"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
          }}
          disabled={processing}
        />
        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-brand-600 to-brand-900 flex items-center justify-center">
          <Upload className="w-5 h-5 text-white" />
        </div>
        <div className="text-sm text-white/80 font-medium">
          {processing ? "Procesando…" : "Arrastrá o tocá para subir"}
        </div>
        <div className="text-[11px] text-white/40 font-mono uppercase flex items-center gap-2">
          <ImageIcon className="w-3 h-3" /> JPG · PNG · WebP · PDF · máx 6 MB
        </div>
      </label>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </motion.div>
  )
}
