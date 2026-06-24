import { motion } from "framer-motion"
import { Zap } from "lucide-react"
import { useEffect, useState } from "react"
import { openChat } from "../lib/chatBus"

const links = [
  { href: "#features", label: "Tweaks" },
  { href: "#pricing", label: "Packs" },
  { href: "#how", label: "Cómo funciona" },
  { href: "#sobre-mi", label: "Sobre mí" },
  { href: "#faq", label: "FAQ" },
]

export default function Navbar() {
  const [activeId, setActiveId] = useState<string>("")

  useEffect(() => {
    const ids = links.map((l) => l.href.slice(1))
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null)

    if (sections.length === 0) return

    const visibility = new Map<string, number>()

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          visibility.set(entry.target.id, entry.intersectionRatio)
        })
        let bestId = ""
        let bestRatio = 0
        visibility.forEach((ratio, id) => {
          if (ratio > bestRatio) {
            bestRatio = ratio
            bestId = id
          }
        })
        if (bestRatio > 0) setActiveId(bestId)
      },
      {
        rootMargin: "-80px 0px -40% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    )

    sections.forEach((s) => observer.observe(s))
    return () => observer.disconnect()
  }, [])

  return (
    <motion.header
      initial={{ y: -60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="fixed top-0 left-0 right-0 z-50"
    >
      <div className="bg-black/85 border-b border-brand-900/40">
        <div className="max-w-7xl mx-auto flex items-center justify-between px-6 md:px-10 lg:px-16 py-4">
          <a href="#" className="flex items-center gap-2 group">
            <div className="relative">
              <div className="absolute inset-0 bg-brand-500 blur-md opacity-60 group-hover:opacity-100 transition" />
              <Zap className="relative w-7 h-7 text-brand-400" fill="currentColor" />
            </div>
            <span className="font-display font-black text-xl tracking-wider">
              KUNZERA
            </span>
          </a>

          <nav className="hidden md:flex items-center gap-8">
            {links.map((l) => {
              const isActive = activeId === l.href.slice(1)
              return (
                <a
                  key={l.href}
                  href={l.href}
                  className={`text-sm transition-colors relative group ${
                    isActive ? "text-brand-400" : "text-white/70 hover:text-brand-400"
                  }`}
                >
                  {l.label}
                  <span
                    className={`absolute -bottom-1 left-0 h-px bg-brand-500 transition-all duration-300 ${
                      isActive ? "w-full" : "w-0 group-hover:w-full"
                    }`}
                  />
                </a>
              )
            })}
          </nav>

          <button
            onClick={() => openChat({ startReservation: true })}
            className="hidden sm:inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-gradient-to-r from-brand-600 to-brand-800 hover:from-brand-500 hover:to-brand-700 transition shadow-lg shadow-brand-900/50"
          >
            Reservar
          </button>
        </div>
      </div>
    </motion.header>
  )
}
