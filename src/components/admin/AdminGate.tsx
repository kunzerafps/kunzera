import { AnimatePresence } from "framer-motion"
import { Loader2 } from "lucide-react"
import { lazy, Suspense } from "react"
import { useAdminGate } from "../../hooks/useAdminGate"
import AdminLogin from "./AdminLogin"
import ErrorBoundary from "./ErrorBoundary"

// El panel de administración es el bloque de JS más pesado del proyecto y no
// lo usa ningún visitante que venga de un anuncio — sólo Eze, después de
// loguearse. Cargándolo aparte (lazy) deja de viajar en el bundle inicial
// que baja TODA visita, lo que mejora el tiempo de carga en celular (donde
// está la mayoría del tráfico pago). El <Suspense> envuelve al
// <AnimatePresence> para que AdminDashboard siga siendo su hijo directo con
// key y no se rompan las animaciones. El <ErrorBoundary> alrededor evita que
// un fallo al bajar el chunk (ej. index.html viejo apuntando a un hash que
// ya no existe tras un deploy) tumbe TODA la página — sin él, ese rechazo de
// import no lo agarra nadie y React desmonta la app a una pantalla en blanco.
const AdminDashboard = lazy(() => import("./AdminDashboard"))

export default function AdminGate() {
  const { phase, login, logout, close } = useAdminGate()

  return (
    <ErrorBoundary label="el panel de administración" onReset={() => window.location.reload()}>
      <Suspense
        fallback={
          <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70">
            <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
          </div>
        }
      >
        <AnimatePresence>
          {phase === "login" && <AdminLogin key="login" onLogin={login} onClose={close} />}
          {phase === "authed" && (
            <AdminDashboard key="dashboard" onLogout={logout} onClose={close} />
          )}
        </AnimatePresence>
      </Suspense>
    </ErrorBoundary>
  )
}
