import { motion } from "framer-motion"
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { formatARS } from "../../lib/formatters"
import { getAdminToken } from "../../lib/storage"

type Ingresos = {
  ok: boolean
  rango: { desde: string; hasta: string; dias: number }
  web: { ventas: number; ingresos: number }
  whatsapp: { ventas: number; ingresos: number; error: string | null }
  meta: { gasto: number | null; moneda: string; error: string | null }
  totales: { ingresos: number; gasto: number | null; retorno: number | null }
  porCampana: {
    campana: string
    ventas: number
    ingresos: number
    gasto: number | null
    retorno: number | null
  }[]
  recompra: {
    clientesUnicos: number
    clientesQueVolvieron: number
    ventasDeRecompra: number
    ingresosDeRecompra: number
    ingresoPromedioPorCliente: number
  }
}

const RANGOS = [30, 60, 90] as const

export default function IngresosPanel() {
  const [dias, setDias] = useState<number>(30)
  const [data, setData] = useState<Ingresos | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (d: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/admin-ingresos?token=${encodeURIComponent(getAdminToken() || "")}&days=${d}`,
      )
      const json = (await res.json().catch(() => ({}))) as Ingresos & { error?: string }
      if (!json.ok) {
        setError(
          (json as { error?: string }).error === "unauthorized"
            ? "Sesión vencida, volvé a entrar"
            : "No se pudo cargar. " + ((json as { error?: string }).error || ""),
        )
        return
      }
      setData(json)
    } catch (err) {
      setError("Error de red: " + String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(dias)
  }, [load, dias])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5">
          {RANGOS.map((r) => (
            <button
              key={r}
              onClick={() => setDias(r)}
              className={`px-3 py-1.5 text-xs rounded-full transition ${
                dias === r
                  ? "bg-brand-500 text-white border border-brand-400"
                  : "bg-brand-950/80 text-brand-200 border border-brand-700/50 hover:border-brand-500"
              }`}
            >
              {r} días
            </button>
          ))}
        </div>
        <button
          onClick={() => load(dias)}
          disabled={loading}
          className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center transition disabled:opacity-50"
          aria-label="Refrescar"
        >
          <RefreshCw className={`w-4 h-4 text-white ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {loading && !data ? (
        <div className="text-center py-16 text-white/40 text-sm flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card titulo="Ingresos totales" valor={formatARS(data.totales.ingresos)} sub={`${data.web.ventas + data.whatsapp.ventas} ventas`} />
            <Card
              titulo="Gasto en Meta"
              valor={data.totales.gasto === null ? "—" : formatARS(data.totales.gasto)}
              sub={data.meta.error ? "no se pudo leer" : `moneda ${data.meta.moneda}`}
              alerta={!!data.meta.error}
            />
            <Card
              titulo="Retorno"
              valor={data.totales.retorno === null ? "—" : `${data.totales.retorno}x`}
              sub="ingresos ÷ gasto"
            />
            <Card
              titulo="Ticket promedio"
              valor={formatARS(data.recompra.ingresoPromedioPorCliente)}
              sub="por cliente"
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card titulo="Ventas web" valor={String(data.web.ventas)} sub={formatARS(data.web.ingresos)} />
            <Card
              titulo="Ventas WhatsApp"
              valor={String(data.whatsapp.ventas)}
              sub={data.whatsapp.error ? "no se pudo leer" : formatARS(data.whatsapp.ingresos)}
              alerta={!!data.whatsapp.error}
            />
            <Card
              titulo="Clientes distintos"
              valor={String(data.recompra.clientesUnicos)}
              sub="histórico total"
            />
            <Card
              titulo="Volvieron a comprar"
              valor={String(data.recompra.clientesQueVolvieron)}
              sub={`histórico · ≈ ${formatARS(data.recompra.ingresosDeRecompra)} de recompra`}
            />
          </div>

          {data.meta.error && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              El gasto de Meta no se pudo leer ({data.meta.error}). El resto de los números son reales;
              solo falta el gasto y el retorno.
            </div>
          )}
          {data.whatsapp.error && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              El registro de ventas por WhatsApp no se pudo leer ({data.whatsapp.error}). Los números
              muestran solo las ventas web.
            </div>
          )}

          <div className="glass-card rounded-2xl p-4 md:p-6">
            <h3 className="text-sm font-semibold text-white mb-1">Por campaña (ventas de WhatsApp)</h3>
            <p className="text-[11px] text-white/40 mb-4 leading-relaxed">
              Solo las ventas de WhatsApp — las reservas de la web no guardan de qué campaña vinieron.
              El gasto se cruza por nombre de campaña; si no aparece, es que el nombre no coincide
              exacto con el de Meta.
            </p>
            {data.porCampana.length === 0 ? (
              <div className="text-center py-8 text-white/40 text-sm">Sin ventas de WhatsApp en el rango</div>
            ) : (
              <div className="overflow-x-auto -mx-4 md:mx-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] font-mono uppercase tracking-widest text-white/40 border-b border-white/5">
                      <th className="text-left py-2 px-4 md:px-2">Campaña</th>
                      <th className="text-right py-2 px-2">Ventas</th>
                      <th className="text-right py-2 px-2">Ingresos</th>
                      <th className="text-right py-2 px-2">Gasto</th>
                      <th className="text-right py-2 px-4 md:px-2">Retorno</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.porCampana.map((c) => (
                      <tr key={c.campana} className="border-b border-white/5">
                        <td className="py-3 px-4 md:px-2 text-white">{c.campana}</td>
                        <td className="py-3 px-2 text-right font-mono text-white/80">{c.ventas}</td>
                        <td className="py-3 px-2 text-right font-mono text-white">{formatARS(c.ingresos)}</td>
                        <td className="py-3 px-2 text-right font-mono text-white/60">
                          {c.gasto === null ? "—" : formatARS(c.gasto)}
                        </td>
                        <td className="py-3 px-4 md:px-2 text-right font-mono">
                          {c.retorno === null ? (
                            <span className="text-white/30">—</span>
                          ) : (
                            <span className={c.retorno >= 1 ? "text-emerald-300" : "text-amber-300"}>
                              {c.retorno}x
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="text-[11px] text-white/30 leading-relaxed">
            Vista de lectura, se arma al vuelo juntando el Sheet de reservas + las ventas de WhatsApp +
            el gasto de Meta. “Venta web” = reserva confirmada o atendida (las pendientes no cuentan).
            No resta reintegros de ventas web.
          </p>
        </>
      ) : null}
    </div>
  )
}

function Card({
  titulo,
  valor,
  sub,
  alerta,
}: {
  titulo: string
  valor: string
  sub?: string
  alerta?: boolean
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-1">{titulo}</div>
      <div className={`text-xl font-display font-bold ${alerta ? "text-amber-300" : "text-white"}`}>
        {valor}
      </div>
      {sub && <div className="text-[11px] text-white/40 mt-0.5">{sub}</div>}
    </div>
  )
}
