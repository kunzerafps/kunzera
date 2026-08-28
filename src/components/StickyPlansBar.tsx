import { useEffect, useState } from "react"
import { useSiteConfig } from "../hooks/useWaMessages"

// Barra fija, SOLO en celular, con el precio más bajo + acceso directo a los
// planes. Aparece recién cuando el Hero salió de vista, así no pisa los
// botones ni el renglón de precio que ya están en la portada. En escritorio
// no se muestra (el menú tiene "Planes" siempre visible).
export default function StickyPlansBar() {
  const { prices } = useSiteConfig()
  const [show, setShow] = useState(false)

  useEffect(() => {
    const hero = document.getElementById("hero")
    if (!hero) return
    const obs = new IntersectionObserver(
      ([entry]) => setShow(!entry.isIntersecting),
    )
    obs.observe(hero)
    return () => obs.disconnect()
  }, [])

  const desde = Math.min(prices.platino.ars, prices.diamante.ars)

  return (
    <div
      className={`md:hidden fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 px-4 py-2.5 bg-[#0a0a0b]/95 backdrop-blur border-t border-brand-900/70 transition-transform duration-300 ${
        show ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <span className="text-sm text-white/80">
        Desde{" "}
        <b className="font-mono text-white">${desde.toLocaleString("es-AR")}</b>
        <span className="text-white/40"> · pago único</span>
      </span>
      <a
        href="#pricing"
        className="text-sm font-bold text-white bg-gradient-to-r from-brand-500 to-brand-800 px-4 py-2 rounded-lg whitespace-nowrap"
      >
        Ver planes
      </a>
    </div>
  )
}
