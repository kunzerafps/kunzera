const GAMES = [
  "Valorant",
  "CS2",
  "Fortnite",
  "Warzone",
  "League of Legends",
  "Apex Legends",
  "GTA V",
  "Rocket League",
  "PUBG",
  "FiveM",
  "FIFA",
  "Rust",
  "Minecraft",
  "Rainbow Six Siege",
  "y cualquier otro juego",
]

export default function GamesStrip() {
  return (
    <div className="relative border-b border-brand-900/40">
      <div className="max-w-7xl mx-auto section-padding py-5">
        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <span className="text-xs font-mono uppercase tracking-widest text-white/40 mr-1">
            Funciona en:
          </span>
          {GAMES.map((g) => (
            <span
              key={g}
              className="px-3.5 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm text-white/70"
            >
              {g}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
