import { useMemo } from "react"
import { Zap } from "lucide-react"
import { SiWhatsapp, SiDiscord, SiInstagram, SiTiktok } from "react-icons/si"
import { waLink, WHATSAPP_MESSAGE_GENERAL } from "../lib/constants"
import { withAdReturnLink } from "../lib/deeplink"
import { trackServerBackedEvent } from "../lib/pixel"

export default function Footer() {
  // Mismo criterio que el boton flotante: si la visita vino de un anuncio,
  // el mensaje pre-escrito de WhatsApp arrastra el link de regreso con
  // fbclid+utm para no perder la atribucion de la compra.
  const waHref = useMemo(() => waLink(withAdReturnLink(WHATSAPP_MESSAGE_GENERAL)), [])

  return (
    <footer className="relative border-t border-brand-900/40 bg-black/80">
      <div className="max-w-7xl mx-auto section-padding py-12">
        <div className="grid md:grid-cols-4 gap-8 mb-10">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="relative">
                <div className="absolute inset-0 bg-brand-500 blur-md opacity-60" />
                <Zap className="relative w-7 h-7 text-brand-400" fill="currentColor" />
              </div>
              <span className="font-display font-black text-xl tracking-wider">
                KUNZERA
              </span>
            </div>
            <p className="text-white/50 text-sm max-w-sm leading-relaxed">
              Optimización profesional de PC para gamers. Windows tweaks, BIOS
              avanzado y overclock.
            </p>
          </div>

          <div>
            <h4 className="font-semibold text-sm uppercase tracking-widest mb-4 text-white/80">
              Servicios
            </h4>
            <ul className="space-y-2 text-sm text-white/50">
              <li>
                <a href="#pricing" className="hover:text-brand-400 transition">
                  Pack Platino
                </a>
              </li>
              <li>
                <a href="#pricing" className="hover:text-brand-400 transition">
                  Pack Diamante
                </a>
              </li>
              <li>
                <a href="#features" className="hover:text-brand-400 transition">
                  Tweaks
                </a>
              </li>
              <li>
                <a href="#how" className="hover:text-brand-400 transition">
                  Cómo funciona
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-sm uppercase tracking-widest mb-4 text-white/80">
              Contacto
            </h4>
            <div className="flex gap-3 mb-4">
              <a
                href={waHref}
                target="_blank"
                rel="noreferrer"
                onClick={() => trackServerBackedEvent("Contact", {}, { content_name: "footer_whatsapp" })}
                className="w-10 h-10 rounded-lg bg-white/5 hover:bg-brand-500/20 border border-white/10 hover:border-brand-500/60 flex items-center justify-center transition"
                aria-label="WhatsApp"
              >
                <SiWhatsapp className="w-4 h-4" />
              </a>
              <a
                href="https://discord.gg/8etjdmy3"
                target="_blank"
                rel="noreferrer"
                className="w-10 h-10 rounded-lg bg-white/5 hover:bg-brand-500/20 border border-white/10 hover:border-brand-500/60 flex items-center justify-center transition"
                aria-label="Discord"
              >
                <SiDiscord className="w-4 h-4" />
              </a>
              <a
                href="https://www.instagram.com/ezekunnnn/"
                target="_blank"
                rel="noreferrer"
                className="w-10 h-10 rounded-lg bg-white/5 hover:bg-brand-500/20 border border-white/10 hover:border-brand-500/60 flex items-center justify-center transition"
                aria-label="Instagram"
              >
                <SiInstagram className="w-4 h-4" />
              </a>
              <a
                href="#"
                className="w-10 h-10 rounded-lg bg-white/5 hover:bg-brand-500/20 border border-white/10 hover:border-brand-500/60 flex items-center justify-center transition"
                aria-label="TikTok"
              >
                <SiTiktok className="w-4 h-4" />
              </a>
            </div>
            <p className="text-xs text-white/40 font-mono">
              Respuesta en minutos
            </p>
          </div>
        </div>

        <div className="pt-6 border-t border-white/5 flex flex-col sm:flex-row gap-3 justify-between items-center text-xs text-white/40 font-mono">
          <div>© {new Date().getFullYear()} KUNZERA · Todos los derechos reservados.</div>
          <div>PC Optimizer · Windows Tweaks & Advanced BIOS</div>
        </div>
      </div>
    </footer>
  )
}
