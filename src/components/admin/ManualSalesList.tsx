import { motion } from "framer-motion"
import { Check, Copy, Download, Loader2, RefreshCw, RotateCw, Search, Undo2, XCircle } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { formatARS } from "../../lib/formatters"
import { getAdminToken } from "../../lib/storage"
import { ventasToCsv } from "../../lib/manualSalesCsv"

// Espejo del tipo de netlify/functions/lib/manualSalesStore.ts — solo lo que
// consume esta pantalla.
type ManualSale = {
  id: string
  createdAt: number
  saleDate: string
  nombre: string
  whatsapp: string
  email: string
  monto: number
  pack?: string
  campania?: string
  metaEventId: string
  metaStatus: "ok" | "error"
  metaError?: string
  canceled?: boolean
  cancelMetaStatus?: "ok" | "error" | "skipped"
  nota?: string
}

type StatusFilter = "todas" | "enviadas" | "pendientes" | "canceladas"

function downloadCsv(filename: string, content: string): void {
  // BOM (﻿) para que Excel abra el CSV en UTF-8 y no rompa los acentos.
  const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// "2026-08-27" -> "27/08" sin pasar por Date (evita el corrimiento de día
// por zona horaria que tendría un new Date("YYYY-MM-DD")).
function shortSaleDate(d: string): string {
  const [, m, day] = d.split("-")
  return day && m ? `${day}/${m}` : d
}

function loadedAt(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      timeZone: "America/Argentina/Buenos_Aires",
    })
  } catch {
    return "—"
  }
}

export default function ManualSalesList({ refreshKey = 0 }: { refreshKey?: number }) {
  const [ventas, setVentas] = useState<ManualSale[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todas")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/capi-venta-manual-list?token=${encodeURIComponent(getAdminToken() || "")}&limit=500`)
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; ventas?: ManualSale[]; error?: string }
      if (!data.ok || !Array.isArray(data.ventas)) {
        setError(data.error === "unauthorized" ? "Sesión vencida, volvé a entrar" : "No se pudo cargar la lista")
        return
      }
      setVentas(data.ventas)
    } catch (err) {
      setError("Error de red: " + String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const act = async (
    venta: ManualSale,
    action: "cancel" | "reactivate" | "retry-meta" | "retry-cancel-meta",
  ) => {
    setBusyId(venta.id)
    try {
      const res = await fetch("/api/capi-venta-manual-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: getAdminToken(), eventId: venta.metaEventId, action }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        venta?: ManualSale
        error?: string
        metaError?: string
        cancelMetaStatus?: "ok" | "error" | "skipped"
      }
      if (data.venta) {
        setVentas((prev) => prev.map((v) => (v.metaEventId === venta.metaEventId ? (data.venta as ManualSale) : v)))
      }
      if (data.ok && action === "cancel" && data.cancelMetaStatus === "error") {
        setError(
          "La venta quedó cancelada, pero no se pudo avisarle a Meta. Usá “Reintentar aviso” en la fila.",
        )
      } else if (!data.ok) {
        const msg: Record<string, string> = {
          unauthorized: "Sesión vencida, volvé a entrar",
          rate_limited: "Demasiadas acciones seguidas, esperá un momento",
          fecha_muy_vieja: "Esa venta ya tiene más de 7 días — Meta no la acepta aunque reintentes",
          venta_cancelada: "La venta está cancelada. Reactivala antes de reintentar el aviso a Meta.",
          no_cancelada: "Esa venta no está cancelada.",
        }
        setError(
          (data.error && msg[data.error]) ||
            (action === "retry-meta" || action === "retry-cancel-meta"
              ? "El reintento a Meta volvió a fallar. Probá de nuevo en un rato."
              : "No se pudo aplicar el cambio"),
        )
      } else {
        setError(null)
      }
    } catch (err) {
      setError("Error de red: " + String(err))
    } finally {
      setBusyId(null)
    }
  }

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id)
      setCopiedId(id)
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 2000)
    } catch {
      // clipboard bloqueado — el ID igual está a la vista
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return ventas.filter((v) => {
      if (statusFilter === "enviadas" && !(v.metaStatus === "ok" && !v.canceled)) return false
      if (statusFilter === "pendientes" && !(v.metaStatus === "error" && !v.canceled)) return false
      if (statusFilter === "canceladas" && !v.canceled) return false
      if (!q) return true
      return (
        v.nombre.toLowerCase().includes(q) ||
        v.email.toLowerCase().includes(q) ||
        v.whatsapp.toLowerCase().includes(q) ||
        v.id.toLowerCase().includes(q) ||
        (v.campania || "").toLowerCase().includes(q)
      )
    })
  }, [ventas, query, statusFilter])

  const pendientes = ventas.filter((v) => v.metaStatus === "error" && !v.canceled).length

  const resumen = useMemo(() => {
    let enviadasN = 0
    let enviadasMonto = 0
    let canceladasN = 0
    let canceladasMonto = 0
    for (const v of ventas) {
      if (v.canceled) {
        canceladasN++
        canceladasMonto += v.monto
      } else if (v.metaStatus === "ok") {
        enviadasN++
        enviadasMonto += v.monto
      }
    }
    return { enviadasN, enviadasMonto, canceladasN, canceladasMonto }
  }, [ventas])

  // Exporta lo que estás viendo, pero SIN las canceladas (el CSV es para
  // subir a Meta como compras).
  const exportables = filtered.filter((v) => !v.canceled)

  const exportar = () => {
    if (exportables.length === 0) return
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })
    downloadCsv(`ventas-whatsapp-${hoy}.csv`, ventasToCsv(exportables))
  }

  return (
    <div className="glass-card rounded-2xl p-4 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, email, WhatsApp, campaña o ID…"
            className="w-full bg-white/5 border border-white/10 focus:border-brand-500/60 focus:bg-white/10 outline-none rounded-xl pl-9 pr-4 py-2 text-sm text-white placeholder:text-white/30"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {(["todas", "enviadas", "pendientes", "canceladas"] as StatusFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap transition ${
                statusFilter === f
                  ? "bg-brand-500 text-white border border-brand-400"
                  : "bg-brand-950/80 text-brand-200 border border-brand-700/50 hover:border-brand-500"
              }`}
            >
              {f === "pendientes" && pendientes > 0 ? `Pendientes (${pendientes})` : f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <button
          onClick={exportar}
          disabled={exportables.length === 0}
          className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-xs transition disabled:opacity-40 shrink-0"
          title="Descargar un CSV de las ventas que estás viendo (sin las canceladas) para subir a Meta como conversiones offline"
        >
          <Download className="w-4 h-4" /> <span className="hidden sm:inline">Exportar</span>
        </button>
        <button
          onClick={load}
          disabled={loading}
          className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center transition disabled:opacity-50 shrink-0"
          aria-label="Refrescar"
        >
          <RefreshCw className={`w-4 h-4 text-white ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {!loading && ventas.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 mb-4 text-[11px] font-mono text-white/50">
          <span className="text-white/35 uppercase tracking-wide">Total</span>
          <span>
            <span className="text-emerald-300">{resumen.enviadasN}</span> enviadas ·{" "}
            {formatARS(resumen.enviadasMonto)}
          </span>
          {pendientes > 0 && (
            <span>
              <span className="text-amber-300">{pendientes}</span> pendientes
            </span>
          )}
          {resumen.canceladasN > 0 && (
            <span>
              <span className="text-white/70">{resumen.canceladasN}</span> canceladas ·{" "}
              −{formatARS(resumen.canceladasMonto)}
            </span>
          )}
        </div>
      )}

      {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

      {loading ? (
        <div className="text-center py-12 text-white/40 text-sm flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-white/40 text-sm">
          {ventas.length === 0 ? "Todavía no cargaste ninguna venta por WhatsApp" : "No coincide con el filtro"}
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 md:mx-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] font-mono uppercase tracking-widest text-white/40 border-b border-white/5">
                <th className="text-left py-2 px-4 md:px-2">Venta</th>
                <th className="text-left py-2 px-2">Cliente</th>
                <th className="text-left py-2 px-2 hidden md:table-cell">Campaña</th>
                <th className="text-right py-2 px-2">Monto</th>
                <th className="text-left py-2 px-2">Meta</th>
                <th className="text-left py-2 px-2">ID</th>
                <th className="text-right py-2 px-4 md:px-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v, i) => (
                <motion.tr
                  key={v.metaEventId}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  className={`border-b border-white/5 ${v.canceled ? "opacity-40" : "hover:bg-white/5"}`}
                >
                  <td className="py-3 px-4 md:px-2 whitespace-nowrap">
                    <div className={`text-white ${v.canceled ? "line-through" : ""}`}>
                      {shortSaleDate(v.saleDate)}
                    </div>
                    <div className="text-[10px] text-white/30 font-mono">cargada {loadedAt(v.createdAt)}</div>
                  </td>
                  <td className="py-3 px-2">
                    <div className={`text-white font-medium ${v.canceled ? "line-through" : ""}`}>{v.nombre}</div>
                    <div className="text-[11px] text-white/40">{v.whatsapp}</div>
                    <div className="text-[11px] text-white/40">{v.email}</div>
                  </td>
                  <td className="py-3 px-2 hidden md:table-cell text-white/60 text-xs">
                    {v.campania || <span className="text-white/25">—</span>}
                    {v.pack ? <div className="text-[10px] text-white/30 uppercase font-mono">{v.pack}</div> : null}
                  </td>
                  <td className="py-3 px-2 text-right font-mono text-white">{formatARS(v.monto)}</td>
                  <td className="py-3 px-2">
                    {v.canceled ? (
                      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-mono uppercase bg-white/10 text-white/50 border border-white/15">
                        cancelada
                      </span>
                    ) : v.metaStatus === "ok" ? (
                      <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-mono uppercase bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        enviada
                      </span>
                    ) : (
                      <span
                        className="inline-block px-2 py-0.5 rounded-full text-[10px] font-mono uppercase bg-amber-500/15 text-amber-300 border border-amber-500/30"
                        title={v.metaError || "El aviso a Meta falló"}
                      >
                        pendiente
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-2">
                    <button
                      onClick={() => copyId(v.id)}
                      className="inline-flex items-center gap-1 text-xs font-mono text-white/70 hover:text-white transition"
                      title="Copiar número de orden"
                    >
                      {v.id}
                      {copiedId === v.id ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3 opacity-50" />
                      )}
                    </button>
                  </td>
                  <td className="py-3 px-4 md:px-2 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      {v.metaStatus === "error" && !v.canceled && (
                        <button
                          onClick={() => act(v, "retry-meta")}
                          disabled={busyId === v.id}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-xs transition disabled:opacity-50"
                        >
                          {busyId === v.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />}
                          Reintentar
                        </button>
                      )}
                      {v.canceled && v.cancelMetaStatus === "error" && (
                        <button
                          onClick={() => act(v, "retry-cancel-meta")}
                          disabled={busyId === v.id}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-xs transition disabled:opacity-50"
                          title="El aviso de cancelación a Meta falló"
                        >
                          {busyId === v.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCw className="w-3 h-3" />}
                          Reintentar aviso
                        </button>
                      )}
                      {v.canceled ? (
                        <button
                          onClick={() => act(v, "reactivate")}
                          disabled={busyId === v.id}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 text-xs transition disabled:opacity-50"
                        >
                          <Undo2 className="w-3 h-3" /> Reactivar
                        </button>
                      ) : (
                        <button
                          onClick={() => act(v, "cancel")}
                          disabled={busyId === v.id}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 hover:text-white/80 text-xs transition disabled:opacity-50"
                          title="La venta se cayó / el cliente se arrepintió"
                        >
                          <XCircle className="w-3 h-3" /> Cancelar
                        </button>
                      )}
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-[11px] text-white/30 leading-relaxed">
        Solo ventas cerradas por WhatsApp que no pasaron por el sitio. “Cancelar” deja el registro,
        marca que la venta se cayó y le manda a Meta un aviso de “compra cancelada” (Meta no resta la
        venta solo, pero queda registrada para la métrica de ingresos netos). “Exportar” baja lo que
        estás viendo en un CSV para subir a Meta como conversiones offline.
      </p>
    </div>
  )
}
