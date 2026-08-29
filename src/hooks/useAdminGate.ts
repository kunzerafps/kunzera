import { useCallback, useEffect, useState } from "react"
import { clearAdminAuth, isAdminAuthed, setAdminAuthed } from "../lib/storage"
import { sha256 } from "../lib/crypto"

type Phase = "closed" | "login" | "authed"

export function useAdminGate() {
  const [phase, setPhase] = useState<Phase>(() =>
    isAdminAuthed() ? "authed" : "closed",
  )

  useEffect(() => {
    const check = () => {
      const isAdmin = window.location.hash === "#admin"
      if (isAdmin) {
        setPhase((p) => (p === "authed" ? "authed" : "login"))
      } else if (phase === "login") {
        setPhase("closed")
      }
    }
    check()
    window.addEventListener("hashchange", check)
    return () => window.removeEventListener("hashchange", check)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // La contraseña se sigue hasheando en el navegador antes de mandarla
  // (mismo hash que antes, no cambia lo que el admin escribe), pero ahora
  // quien decide si es correcta es el servidor (/api/admin-login) — no el
  // cliente comparando contra un hash que también viajaba en el bundle
  // público. Si es correcta, el servidor devuelve una sesión firmada con
  // vencimiento en vez de que el cliente se autoconceda acceso.
  const login = useCallback(async (password: string): Promise<boolean> => {
    const passwordHash = await sha256(password)
    try {
      const res = await fetch("/api/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passwordHash }),
      })
      const data = (await res.json().catch(() => null)) as
        | { ok: true; token: string }
        | { ok: false; error: string }
        | null
      if (data?.ok) {
        setAdminAuthed(data.token)
        // Marca este dispositivo como "del equipo" para que no genere eventos
        // de Meta (ni ahora en el panel, ni después navegando el sitio). Se
        // guarda el timestamp: isStaffSession lo vence a los ~90 días, así
        // abrir el panel una vez en una PC ajena no la silencia para siempre.
        // Para reactivar antes: entrar con ?kz_track=1. Ver src/lib/pixel.ts.
        try {
          localStorage.setItem("kz_staff", String(Date.now()))
        } catch {
          // localStorage no disponible — el chequeo de "#admin" igual cubre
          // la sesión del panel en curso.
        }
        setPhase("authed")
        return true
      }
      return false
    } catch {
      return false
    }
  }, [])

  const logout = useCallback(() => {
    clearAdminAuth()
    setPhase("closed")
    if (typeof history !== "undefined") {
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      )
    }
  }, [])

  const close = useCallback(() => {
    setPhase("closed")
    if (window.location.hash === "#admin") {
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      )
    }
  }, [])

  return { phase, login, logout, close }
}
