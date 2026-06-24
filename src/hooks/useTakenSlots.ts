import { useCallback, useEffect, useRef, useState } from "react"
import { getTakenSlots } from "../lib/appsScript"
import { generateSlots } from "../lib/slots"
import { fetchSiteConfig, readCachedSiteConfig } from "../lib/waMessages"
import type { Slot } from "../types/order"

const CACHE_TTL_MS = 60 * 1000

type State = {
  slots: Slot[]
  loading: boolean
  error: boolean
}

export function useTakenSlots(active: boolean): State & { refresh: () => void } {
  const [state, setState] = useState<State>({ slots: [], loading: true, error: false })
  const lastFetched = useRef<number>(0)
  const inflight = useRef<Promise<void> | null>(null)

  const load = useCallback(async (force = false) => {
    if (!force && Date.now() - lastFetched.current < CACHE_TTL_MS && state.slots.length > 0) {
      return
    }
    if (inflight.current) return inflight.current

    setState((s) => ({ ...s, loading: true, error: false }))
    const p = (async () => {
      try {
        const [taken, config] = await Promise.all([
          getTakenSlots(),
          fetchSiteConfig(force),
        ])
        const slots = generateSlots(taken, new Date(), config.blockedWindows)
        lastFetched.current = Date.now()
        setState({ slots, loading: false, error: false })
      } catch {
        const cached = readCachedSiteConfig()
        setState({
          slots: generateSlots([], new Date(), cached.blockedWindows),
          loading: false,
          error: true,
        })
      } finally {
        inflight.current = null
      }
    })()
    inflight.current = p
    return p
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (active) load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  return { ...state, refresh: () => load(true) }
}
