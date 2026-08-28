import { AnimatePresence } from "framer-motion"
import { lazy, Suspense } from "react"
import { useAdminGate } from "../../hooks/useAdminGate"
import AdminLogin from "./AdminLogin"

// El panel de administración es el bloque de JS más pesado del proyecto y no
// lo usa ningún visitante que venga de un anuncio — sólo Eze, después de
// loguearse. Cargándolo aparte (lazy) deja de viajar en el bundle inicial
// que baja TODA visita, lo que mejora el tiempo de carga en celular (donde
// está la mayoría del tráfico pago). El <Suspense> envuelve al
// <AnimatePresence> para que AdminDashboard siga siendo su hijo directo con
// key y no se rompan las animaciones de entrada/salida.
const AdminDashboard = lazy(() => import("./AdminDashboard"))

export default function AdminGate() {
  const { phase, login, logout, close } = useAdminGate()

  return (
    <Suspense fallback={null}>
      <AnimatePresence>
        {phase === "login" && <AdminLogin key="login" onLogin={login} onClose={close} />}
        {phase === "authed" && (
          <AdminDashboard key="dashboard" onLogout={logout} onClose={close} />
        )}
      </AnimatePresence>
    </Suspense>
  )
}
