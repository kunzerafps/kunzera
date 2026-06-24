import { ACCEPTED_MIME, MAX_FILE_BYTES } from "./constants"

export function validateName(value: string): string | null {
  const v = value.trim()
  if (v.length < 3) return "Poné tu nombre completo"
  if (v.length > 80) return "Demasiado largo"
  if (!/^[a-záéíóúñü][a-záéíóúñü ,.'\-]+$/i.test(v)) return "Usá solo letras y espacios"
  if (!/\s/.test(v)) return "Escribí nombre y apellido"
  return null
}

export function validateWhatsapp(value: string): string | null {
  const v = value.replace(/\D/g, "")
  if (!v) return "Ingresá tu número"
  if (v.length < 8) return "Número muy corto"
  if (v.length > 11) return "Demasiados dígitos"
  return null
}

export function normalizeWhatsapp(value: string): string {
  // Guardamos solo los dígitos del área + número (sin +54 9).
  // El Apps Script agrega 549 al generar el hipervínculo.
  return value.replace(/\D/g, "")
}

export function validateDiscord(value: string): string | null {
  const v = value.trim()
  if (v.length < 2) return "Ingresá tu usuario de Discord"
  if (v.length > 50) return "Demasiado largo"
  if (!/^[a-z0-9._#]+$/i.test(v)) return "Solo letras, números, _ . #"
  return null
}

export function validateFile(file: File): string | null {
  if (!ACCEPTED_MIME.includes(file.type)) {
    return "Solo imágenes (PNG, JPG, WebP) o PDF"
  }
  if (file.size > MAX_FILE_BYTES) {
    return `Máximo ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB`
  }
  if (file.size < 1024) {
    return "El archivo parece estar vacío"
  }
  return null
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // result = "data:image/png;base64,iVBOR..."
      const base64 = result.split(",")[1] || ""
      resolve(base64)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
