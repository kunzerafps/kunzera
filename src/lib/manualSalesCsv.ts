// Genera el CSV de ventas por WhatsApp para subir a Meta como "conversiones
// offline". Separado del componente para poder testearlo sin arrastrar React.

export type ManualSaleForCsv = {
  nombre: string
  whatsapp: string
  email: string
  monto: number
  saleDate: string
  campania?: string
  metaEventId: string
  metaStatus: "ok" | "error"
}

// Última palabra = apellido, el resto = nombre (mismo criterio que el envío a
// Meta del lado del servidor).
export function splitNombre(nombre: string): { fn: string; ln: string } {
  const words = nombre.trim().split(/\s+/).filter(Boolean)
  if (words.length <= 1) return { fn: words[0] || "", ln: "" }
  return { fn: words.slice(0, -1).join(" "), ln: words[words.length - 1] }
}

export function csvCell(v: string | number): string {
  let s = String(v)
  // Anti "fórmula de Excel": si el valor arranca con = + - @ o un
  // tab/retorno, Excel/Sheets lo ejecutaría como fórmula al abrir el CSV.
  // Se le antepone un apóstrofo para neutralizarlo (CWE-1236). El teléfono
  // ya sale como dígitos puros (ver ventasToCsv), así que su "+" no llega
  // hasta acá.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const CSV_HEADER = [
  "email",
  "phone",
  "fn",
  "ln",
  "value",
  "currency",
  "event_name",
  "event_time",
  "order_id",
  "campania",
  "estado",
]

// El caller ya filtró las canceladas (no son compras). Acá solo se arma el
// texto.
export function ventasToCsv(rows: ManualSaleForCsv[]): string {
  const lines = rows.map((v) => {
    const { fn, ln } = splitNombre(v.nombre)
    const estado = v.metaStatus === "ok" ? "enviada" : "pendiente"
    return [
      v.email,
      // Solo dígitos: Meta normaliza el teléfono quitando todo lo que no sea
      // número, y así el "+" no queda como prefijo de fórmula en el CSV.
      v.whatsapp.replace(/\D/g, ""),
      fn,
      ln,
      v.monto,
      "ARS",
      "Purchase",
      // noon ART: cae siempre dentro del día calendario, formato ISO que
      // acepta el importador de eventos offline de Meta.
      `${v.saleDate}T12:00:00-03:00`,
      v.metaEventId,
      v.campania || "",
      estado,
    ]
      .map(csvCell)
      .join(",")
  })
  return [CSV_HEADER.join(","), ...lines].join("\r\n")
}
