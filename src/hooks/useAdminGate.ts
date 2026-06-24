import { useCallback, useEffect, useState } from "react"
import { clearAdminAuth, isAdminAuthed, setAdminAuthed } from "../lib/storage"
import { sha256 } from "../lib/crypto"
import { ADMIN_PASSWORD_HASH } from "../lib/constants"
import { fetchSiteConfig, readCachedSiteConfig } from "../lib/waMessages"

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

  const login = useCallback(async (password: string): Promise<boolean> => {
    const h = await sha256(password)
    let saved = ""
    try {
      const config = await fetchSiteConfig()
      saved = config.adminPasswordHash
    } catch {
      saved = readCachedSiteConfig().adminPasswordHash
    }
    const expected = saved || ADMIN_PASSWORD_HASH
    if (h === expected) {
      setAdminAuthed()
      setPhase("authed")
      return true
    }
    return false
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
