import { useEffect, useState } from "react"
import {
  fetchSiteConfig,
  readCachedSiteConfig,
  type SiteConfig,
} from "../lib/waMessages"

export function useSiteConfig(): SiteConfig {
  const [config, setConfig] = useState<SiteConfig>(() => readCachedSiteConfig())

  useEffect(() => {
    let cancelled = false
    fetchSiteConfig().then((c) => {
      if (!cancelled) setConfig(c)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return config
}
