import { Star } from "lucide-react"

export default function TrustStrip() {
  return (
    <div className="relative border-y border-brand-900/40 bg-black/40">
      <div className="max-w-7xl mx-auto section-padding py-5">
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm text-white/70">
          <span className="flex items-center gap-1.5">
            <span className="flex text-brand-500">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="w-3.5 h-3.5 fill-brand-500 text-brand-500" />
              ))}
            </span>
            <b className="font-display text-white">5.0</b> de clientes
          </span>
          <span className="w-px h-4 bg-white/15" />
          <span>
            <b className="font-display text-white">+6000</b> PCs optimizadas
          </span>
          <span className="w-px h-4 bg-white/15" />
          <span>
            <b className="font-display text-white">99%</b> tasa de éxito
          </span>
          <span className="w-px h-4 bg-white/15" />
          <span>
            <b className="font-display text-white">100%</b> remoto, sin moverte
          </span>
          <span className="w-px h-4 bg-white/15" />
          <span>
            Optimizando PCs desde <b className="font-display text-white">2012</b>
          </span>
        </div>
      </div>
    </div>
  )
}
