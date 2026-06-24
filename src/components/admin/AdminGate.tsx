import { AnimatePresence } from "framer-motion"
import { useAdminGate } from "../../hooks/useAdminGate"
import AdminLogin from "./AdminLogin"
import AdminDashboard from "./AdminDashboard"

export default function AdminGate() {
  const { phase, login, logout, close } = useAdminGate()

  return (
    <AnimatePresence>
      {phase === "login" && <AdminLogin key="login" onLogin={login} onClose={close} />}
      {phase === "authed" && (
        <AdminDashboard key="dashboard" onLogout={logout} onClose={close} />
      )}
    </AnimatePresence>
  )
}
