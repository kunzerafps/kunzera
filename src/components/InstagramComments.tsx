import { Heart } from "lucide-react"

type Comment = { u: string; t: string; l: number; c: string }

const COMMENTS: Comment[] = [
  { u: "joseebalegno", t: "2 sem", l: 1, c: "Súper recomendable un crack el Eze, gracias por tanto más personas como el 👏👏 Una locura lo que cambia la pc" },
  { u: "leandromagone", t: "3 sem", l: 2, c: "Súper recomendado, tengo un 240 y el juego no se sentía fluido, después de la opti vuela y se siente super smooth todo" },
  { u: "magone_____", t: "2 sem", l: 1, c: "Más que recomendable, me dejo la tostadora como una pc después de la opti 👏👏🔥" },
  { u: "thomileivaa", t: "2 sem", l: 1, c: "Nananana este chabon sabe lo que hace, súper recomendable 🙏🏻❤️" },
  { u: "agussdangelo__", t: "2 sem", l: 1, c: "La verdad vale la pena, muy recomendable. Una locura lo que vuela la PC y todo en menos de 20 minutos. Me saco el sombrero 👏👏" },
  { u: "lucass_sosa_", t: "2 sem", l: 0, c: "Muy recomendable! Ni un drama en minutos te deja la máquina flama, cualquier juego! Y en cuanto a funcionamiento ni hablar 👏" },
  { u: "facuu.alegre", t: "41 sem", l: 0, c: "Lo super recomiedo mal, tengo un 180hz y me tiraba 150 fps y ahora no me baja de los 200 y hasta 350, una locura 🔥🔥" },
  { u: "fede.breska", t: "41 sem", l: 0, c: "Sos un crak eze, de los 200fps ahora me corre a 350fps y yo creía que ya lo tenía optimizado, super recomendado 👏🏻🔥" },
  { u: "marcolimardoo", t: "41 sem", l: 0, c: "Un crackk, en 20 minutos me dejó la compu flama, más de 150 fps de diferencia" },
  { u: "javierimoldi", t: "41 sem", l: 1, c: "Excelente servicio, 150 fps max en una pc media-alta gama, super recomendado 👌🏻" },
  { u: "castrojonathan93", t: "41 sem", l: 2, c: "Un crack Eze, tanto en la optimización como en la atención... recomendadísimo! 👏👏" },
  { u: "ismaamendoza", t: "3 sem", l: 3, c: "Crack, recién me optimizó y no podía jugar, me cambió de 200 fps todo trabado a 400-500 estables, máquina eze" },
  { u: "22781damian", t: "3 sem", l: 2, c: "Hola Kun, soy Damian de Mendoza, te agradezco mucho el laburo, quedó joya y pude jugar al COD sin problema, la compu anda a 1000" },
  { u: "llerissj", t: "14 sem", l: 2, c: "Con la opti pasé de 60-120fps a 200-250, todo en menos de 20min, un capo" },
  { u: "mati.acsm", t: "5 sem", l: 0, c: "Con un Ryzen 7 7800X3D y una 3080 lo tenía en 250-350 fps, con la optimización del Kun lo dejamos en 600-700 fps, una locura 🔥" },
  { u: "thomas_casuccio", t: "14 sem", l: 2, c: "El Eze hace milagros con la pc, súper recomendado! 🔥" },
  { u: "santifrizzo_", t: "30 sem", l: 1, c: "Excelente trabajo, súper rápido y eficaz, de 300/450 fps a 700, un lujo! 🥳💪🏻💪🏻" },
  { u: "juanmandolini", t: "28 sem", l: 3, c: "Tengo un Ryzen 7 5700, GPU 5060 Ti, 32gb de ram, y ningún juego me pasaba los 150 fps estables. Lo contacté, en 30 minutos me optimizó todo, ahora LoL, Valo y CS me van a más de 400 fps, recomendadísimo" },
  { u: "ivantell", t: "33 sem", l: 0, c: "Crackkk, a mi batatita la dejó hecha un Ferrari!" },
  { u: "ferng95", t: "31 sem", l: 0, c: "Un lujo!! Nunca me anduvo tan bien, 100% recomiendo" },
]

function Card({ item }: { item: Comment }) {
  return (
    <div className="flex-none w-[300px] glass-card rounded-2xl p-4">
      <div className="flex items-center gap-2.5 mb-2.5">
        <div className="w-[30px] h-[30px] rounded-full bg-gradient-to-br from-brand-500 to-brand-800 flex items-center justify-center font-display font-bold text-xs text-white flex-none">
          {item.u.charAt(0).toUpperCase()}
        </div>
        <div className="font-semibold text-[13px]">{item.u}</div>
        <div className="ml-auto font-mono text-[11px] text-white/40">{item.t}</div>
      </div>
      <p className="text-[13px] text-white/70 leading-relaxed mb-2.5">{item.c}</p>
      <div className="flex items-center gap-1.5 text-[11px] font-mono text-white/40">
        <Heart className="w-3 h-3 fill-brand-400 text-brand-400" />
        {item.l > 0 && <span>{item.l} me gusta</span>}
      </div>
    </div>
  )
}

export default function InstagramComments() {
  const doubled = [...COMMENTS, ...COMMENTS]

  return (
    <section className="relative pb-24 md:pb-32">
      <div className="max-w-7xl mx-auto section-padding mb-8">
        <div className="text-center max-w-xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand-950/60 border border-brand-900 text-brand-300 text-xs font-mono uppercase tracking-widest mb-5">
            Directo de Instagram
          </div>
          <h2 className="font-display font-black text-4xl md:text-5xl lg:text-6xl mb-4 leading-tight">
            Lo dicen en mis <span className="text-gradient-red">reels</span>
          </h2>
          <p className="text-white/60 text-lg">Comentarios reales, tal cual los dejaron en las publicaciones.</p>
        </div>
      </div>

      <div
        className="relative overflow-hidden"
        style={{ maskImage: "linear-gradient(90deg, transparent, black 6%, black 94%, transparent)" }}
      >
        <div className="flex gap-3.5 w-max animate-marquee-slow hover:[animation-play-state:paused]">
          {doubled.map((item, i) => (
            <Card key={i} item={item} />
          ))}
        </div>
      </div>
    </section>
  )
}
