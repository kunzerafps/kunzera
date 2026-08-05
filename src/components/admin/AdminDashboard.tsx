import { motion } from "framer-motion"
import {
  ArrowLeft,
  BarChart3,
  CalendarDays,
  LogOut,
  MessageCircleHeart,
  RefreshCw,
  Settings,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { Order, AdminMetrics, Pack } from "../../types/order"
import { getOrders } from "../../lib/appsScript"
import { getDayKey, isToday } from "../../lib/formatters"
import MetricsCards from "./MetricsCards"
import OrdersTable from "./OrdersTable"
import SalesChart from "./SalesChart"
import CalendarView from "./CalendarView"
import OrderDetailModal from "./OrderDetailModal"
import DayDetailModal from "./DayDetailModal"
import ErrorBoundary from "./ErrorBoundary"
import WaMessagesEditor from "./WaMessagesEditor"
import ManualSaleModal from "./ManualSaleModal"

type Tab = "dashboard" | "turnos" | "config"

type Props = {
  onLogout: () => void
  onClose: () => void
}

export default function AdminDashboard({ onLogout, onClose }: Props) {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [returnToDay, setReturnToDay] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>("dashboard")
  const [manualSaleOpen, setManualSaleOpen] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const data = await getOrders()
      setOrders(data)
      setLastUpdate(new Date())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const metrics: AdminMetrics = useMemo(() => computeMetrics(orders), [orders])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[55] overflow-y-auto bg-[#070003]"
    >
      {/* Background — radial-gradient en lugar de filter:blur para perf */}
      <div className="fixed inset-0 grid-bg pointer-events-none" />
      <div className="orb w-[500px] h-[500px] top-[-200px] left-[-200px]" style={{ background: "radial-gradient(circle, rgba(197,12,12,0.3) 0%, transparent 65%)" }} />
      <div className="orb w-[400px] h-[400px] bottom-[-200px] right-[-100px]" style={{ background: "radial-gradient(circle, rgba(134,20,20,0.35) 0%, transparent 65%)" }} />

      <div className="relative max-w-7xl mx-auto px-4 md:px-8 py-6 md:py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 md:mb-10">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center transition"
              aria-label="Volver al sitio"
            >
              <ArrowLeft className="w-4 h-4 text-white" />
            </button>
            <div>
              <h1 className="font-display font-black text-2xl md:text-3xl text-white">
                Panel <span className="text-gradient-red">Kunzera</span>
              </h1>
              <p className="text-xs text-white/40 font-mono">
                {lastUpdate
                  ? `Última actualización: ${lastUpdate.toLocaleTimeString("es-AR")}`
                  : "Cargando…"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setManualSaleOpen(true)}
              className="flex items-center gap-2 px-3 md:px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-sm transition"
              aria-label="Registrar venta manual"
            >
              <MessageCircleHeart className="w-4 h-4" />
              <span className="hidden md:inline">Venta manual</span>
            </button>
            <button
              onClick={load}
              disabled={loading}
              className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center transition disabled:opacity-50"
              aria-label="Refrescar"
            >
              <RefreshCw className={`w-4 h-4 text-white ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={onLogout}
              className="flex items-center gap-2 px-3 md:px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-sm transition"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden md:inline">Salir</span>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex items-center gap-1 p-1 rounded-xl bg-white/5 border border-white/10 w-fit">
          <TabButton
            active={tab === "dashboard"}
            onClick={() => setTab("dashboard")}
            icon={<BarChart3 className="w-4 h-4" />}
            label="Dashboard"
          />
          <TabButton
            active={tab === "turnos"}
            onClick={() => setTab("turnos")}
            icon={<CalendarDays className="w-4 h-4" />}
            label="Turnos"
            badge={orders.length > 0 ? orders.length : undefined}
          />
          <TabButton
            active={tab === "config"}
            onClick={() => setTab("config")}
            icon={<Settings className="w-4 h-4" />}
            label="Configuración"
          />
        </div>

        {tab === "dashboard" && (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="mb-6">
              <MetricsCards metrics={metrics} totalOrders={orders.length} />
            </div>
            <div className="mb-6">
              <SalesChart last7={metrics.last7Days} last30={metrics.last30Days} />
            </div>
            <OrdersTable orders={orders} onRowClick={setSelectedOrder} />
          </motion.div>
        )}

        {tab === "turnos" && (
          <motion.div
            key="turnos"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <CalendarView orders={orders} onSelectDay={setSelectedDay} />
          </motion.div>
        )}

        {tab === "config" && (
          <motion.div
            key="config"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            <WaMessagesEditor />
          </motion.div>
        )}
      </div>

      <ErrorBoundary label="Modal del día" onReset={() => setSelectedDay(null)}>
        <DayDetailModal
          dayKey={selectedDay}
          orders={orders}
          onClose={() => setSelectedDay(null)}
          onSelectOrder={(o) => {
            setReturnToDay(selectedDay)
            setSelectedDay(null)
            setSelectedOrder(o)
          }}
        />
      </ErrorBoundary>

      <ErrorBoundary
        label="Detalle del turno"
        onReset={() => {
          setSelectedOrder(null)
          setReturnToDay(null)
        }}
      >
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => {
            setSelectedOrder(null)
            if (returnToDay) {
              setSelectedDay(returnToDay)
              setReturnToDay(null)
            }
          }}
          onStatusChanged={() => {
            load()
            setReturnToDay(null)
          }}
          onDeleted={() => {
            load()
            setReturnToDay(null)
          }}
        />
      </ErrorBoundary>

      <ManualSaleModal open={manualSaleOpen} onClose={() => setManualSaleOpen(false)} />
    </motion.div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  badge?: number
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition ${
        active
          ? "bg-gradient-to-br from-brand-600 to-brand-800 text-white shadow-glow-red"
          : "text-white/60 hover:text-white hover:bg-white/5"
      }`}
    >
      {icon}
      {label}
      {badge !== undefined && (
        <span
          className={`ml-1 text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
            active
              ? "bg-white/20 text-white"
              : "bg-brand-500/20 text-brand-300 border border-brand-500/30"
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  )
}

function computeMetrics(orders: Order[]): AdminMetrics {
  let totalARS = 0
  let todayCount = 0
  const byPlan: Record<Pack, number> = { platino: 0, diamante: 0 }

  for (const o of orders) {
    const monto = Number(o.monto) || 0
    totalARS += monto
    if (isToday(o.turno)) todayCount++
    if (o.plan === "platino" || o.plan === "diamante") {
      byPlan[o.plan] = (byPlan[o.plan] || 0) + 1
    }
  }

  return {
    totalARS,
    todayCount,
    byPlan,
    last7Days: bucketByDay(orders, 7),
    last30Days: bucketByDay(orders, 30),
  }
}

function bucketByDay(orders: Order[], days: number) {
  const buckets = new Map<string, { count: number; monto: number }>()
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 3600 * 1000)
    buckets.set(getDayKey(d), { count: 0, monto: 0 })
  }

  for (const o of orders) {
    const key = getDayKey(o.turno)
    if (!buckets.has(key)) continue
    const b = buckets.get(key)!
    b.count++
    b.monto += Number(o.monto) || 0
  }

  return Array.from(buckets.entries()).map(([date, v]) => ({
    date: date.slice(5), // "MM-DD"
    count: v.count,
    monto: v.monto,
  }))
}
