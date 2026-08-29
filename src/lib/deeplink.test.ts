import { afterEach, describe, expect, it, vi } from "vitest"
import { CHAT_OPEN_EVENT, type OpenChatDetail } from "./chatBus"
import { DEEP_LINKS, handleDeepLink, withAdReturnLink } from "./deeplink"

// vitest.config.ts corre estos tests en entorno "node" (sin DOM), así que
// armamos un window/document/history mínimos a mano. deeplink.ts sólo lee
// window.location.{pathname,search,hash}, window.history.replaceState,
// document.getElementById(...).scrollIntoView y requestAnimationFrame; y vía
// chatBus.openChat hace window.dispatchEvent(new CustomEvent(...)).

type Harness = {
  events: OpenChatDetail[]
  replaceStateArgs: string[]
  scrolledIds: string[]
  location: { pathname: string; search: string; hash: string; href: string }
  sessionStore: Map<string, string>
}

const ORIGIN = "https://kunzera.com"

function setup(url: string): Harness {
  const u = new URL(url, ORIGIN)
  const events: OpenChatDetail[] = []
  const replaceStateArgs: string[] = []
  const scrolledIds: string[] = []

  // EventTarget real -> openChat/dispatchEvent y addEventListener funcionan de verdad.
  const win: any = new EventTarget()
  const location = {
    pathname: u.pathname,
    search: u.search,
    hash: u.hash,
    href: u.href,
  }
  win.location = location
  win.history = {
    replaceState: (_state: unknown, _title: string, nextUrl?: string) => {
      replaceStateArgs.push(nextUrl ?? "")
      if (typeof nextUrl === "string") {
        const next = new URL(nextUrl, location.href)
        location.pathname = next.pathname
        location.search = next.search
        location.hash = next.hash
        location.href = next.href
      }
    },
  }

  vi.stubGlobal("window", win)
  vi.stubGlobal("document", {
    // cookie "" -> getCookie() de cookies.ts no explota en entorno node
    cookie: "",
    getElementById: (id: string) =>
      id === "pricing" ? { scrollIntoView: () => scrolledIds.push(id) } : null,
  })
  // rAF síncrono: scrollToPricing usa doble rAF anidado.
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
    cb()
    return 0
  })
  // sessionStorage en memoria -> getStoredUtm() (utm.ts) puede leer el utm
  // que se guardó al cargar la página aunque la URL actual ya no lo traiga.
  const sessionStore = new Map<string, string>()
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => (sessionStore.has(k) ? sessionStore.get(k)! : null),
    setItem: (k: string, v: string) => {
      sessionStore.set(k, String(v))
    },
    removeItem: (k: string) => {
      sessionStore.delete(k)
    },
  })

  win.addEventListener(CHAT_OPEN_EVENT, (e: Event) => {
    events.push((e as CustomEvent<OpenChatDetail>).detail || {})
  })

  return { events, replaceStateArgs, scrolledIds, location, sessionStore }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("handleDeepLink — ver planes (scroll a #pricing)", () => {
  it.each(["/packs", "/planes", "/precios", "/pricing", "/plan", "/packs/", "/PACKS"])(
    "%s baja a #pricing, no abre chat ni toca la URL",
    (path) => {
      const h = setup(path)
      handleDeepLink()
      expect(h.scrolledIds).toEqual(["pricing"])
      expect(h.events).toEqual([])
      expect(h.replaceStateArgs).toEqual([]) // el path /packs se deja a propósito
    },
  )
})

describe("handleDeepLink — reservar turno directo", () => {
  it.each([
    "/reservar",
    "/reserva",
    "/reservar-ahora",
    "/reservar-turno",
    "/turno",
    "/Reservar",
  ])("%s abre el chat en el flujo de reserva y limpia el path a /", (path) => {
    const h = setup(path)
    handleDeepLink()
    // auto:true -> el chat se abre solo pero NO cuenta como "Contact" en Meta
    expect(h.events).toEqual([{ startReservation: true, auto: true }])
    expect(h.replaceStateArgs).toEqual(["/"])
    expect(h.scrolledIds).toEqual([])
  })
})

describe("handleDeepLink — pack explícito por path", () => {
  it.each([
    ["/reservar/platino", "platino"],
    ["/reservar/diamante", "diamante"],
    ["/packs/platino", "platino"],
    ["/packs/diamante", "diamante"],
    ["/planes/diamante", "diamante"],
    ["/RESERVAR/Platino", "platino"],
  ])("%s abre el chat con el pack elegido y limpia el path", (path, pack) => {
    const h = setup(path)
    handleDeepLink()
    expect(h.events).toEqual([{ pack, auto: true }])
    expect(h.replaceStateArgs).toEqual(["/"])
    expect(h.scrolledIds).toEqual([])
  })

  it("preserva la query (utm) al limpiar el path", () => {
    const h = setup("/reservar/platino?utm_source=fb&utm_campaign=x")
    handleDeepLink()
    expect(h.events).toEqual([{ pack: "platino", auto: true }])
    expect(h.replaceStateArgs).toEqual(["/?utm_source=fb&utm_campaign=x"])
  })
})

describe("handleDeepLink — alias por query (?pack= / ?plan=)", () => {
  it.each([
    ["/?pack=platino", "platino"],
    ["/?pack=diamante", "diamante"],
    ["/packs?plan=diamante", "diamante"],
    ["/?plan=platino&utm_source=ig", "platino"],
  ])("%s abre el chat con el pack elegido", (url, pack) => {
    const h = setup(url)
    handleDeepLink()
    expect(h.events).toEqual([{ pack, auto: true }])
  })

  it("saca ?pack= de la URL para que un F5 no re-abra el chat", () => {
    const h = setup("/?pack=platino")
    handleDeepLink()
    expect(h.replaceStateArgs).toEqual(["/"])
    // 2do handleDeepLink (equivalente a un refresh / StrictMode) -> ya no dispara
    h.events.length = 0
    handleDeepLink()
    expect(h.events).toEqual([])
  })

  it("saca ?plan= pero deja los utm intactos", () => {
    const h = setup("/?plan=diamante&utm_source=ig&utm_campaign=reel")
    handleDeepLink()
    expect(h.replaceStateArgs).toEqual(["/?utm_source=ig&utm_campaign=reel"])
  })
})

describe("handleDeepLink — no interfiere con el regreso de Mercado Pago", () => {
  it.each([
    "/?mp=success&ref=abc123",
    "/?mp=pending&ref=abc123",
    "/?mp=failure",
    "/reservar?mp=success&ref=abc123",
    "/packs?mp=success",
  ])("%s: bail total (sin evento, sin scroll, sin replaceState)", (url) => {
    const h = setup(url)
    handleDeepLink()
    expect(h.events).toEqual([])
    expect(h.scrolledIds).toEqual([])
    expect(h.replaceStateArgs).toEqual([])
  })
})

describe("handleDeepLink — no-op / edge cases", () => {
  it.each(["/", "/foo", "/admin", "/assets/index-abc.js", "/favicon.ico", "/#admin"])(
    "%s no hace nada",
    (url) => {
      const h = setup(url)
      handleDeepLink()
      expect(h.events).toEqual([])
      expect(h.scrolledIds).toEqual([])
      expect(h.replaceStateArgs).toEqual([])
    },
  )

  it("path #admin: no toca el hash (AdminGate depende de él)", () => {
    const h = setup("/#admin")
    handleDeepLink()
    expect(h.location.hash).toBe("#admin")
  })

  it("segmento de pack desconocido en path de packs -> sólo scrollea", () => {
    const h = setup("/packs/oro")
    handleDeepLink()
    expect(h.events).toEqual([])
    expect(h.scrolledIds).toEqual(["pricing"])
  })

  // Los alias de "reservar" (p.ej. /reserva/platino) tambien toman el pack
  // del 2do segmento, igual que /reservar/platino.
  it("/reserva/platino: toma el pack del 2do segmento", () => {
    const h = setup("/reserva/platino")
    handleDeepLink()
    expect(h.events).toEqual([{ pack: "platino", auto: true }])
  })

  it("sin window definido no explota (guard SSR / entorno node)", () => {
    vi.unstubAllGlobals()
    expect(typeof window).toBe("undefined")
    expect(() => handleDeepLink()).not.toThrow()
  })
})

describe("withAdReturnLink — link de regreso en mensajes de WhatsApp", () => {
  it("visita orgánica (sin fbclid ni utm): devuelve el mensaje intacto", () => {
    setup("/")
    expect(withAdReturnLink("Hola, quiero info")).toBe("Hola, quiero info")
  })

  it("visita con fbclid: suma la línea con el link a /reservar", () => {
    setup("/?fbclid=ABC.123")
    const out = withAdReturnLink("Hola, quiero info")
    expect(out.startsWith("Hola, quiero info\n\n» Si querés reservar directo, entrá acá: ")).toBe(true)
    expect(out).toContain("https://kunzera.com/reservar?fbclid=ABC.123")
  })

  it("visita con utm_source pero sin fbclid: también suma el link", () => {
    setup("/?utm_source=ig&utm_campaign=reel")
    const out = withAdReturnLink("Hola")
    expect(out).toContain("https://kunzera.com/reservar?utm_source=ig&utm_campaign=reel")
  })

  // Guard de regresión: el separador exacto lo comparten 3 call sites (botón
  // flotante, footer y el botón "Ir a WhatsApp" del chat). Si cambia acá,
  // rompe la equivalencia con el texto que antes estaba inline.
  it("fbclid: salida byte-exacta (separador + link, sin nada de más)", () => {
    setup("/?fbclid=ABC.123")
    expect(withAdReturnLink("Hola, quiero info")).toBe(
      "Hola, quiero info\n\n» Si querés reservar directo, entrá acá: " +
        "https://kunzera.com/reservar?fbclid=ABC.123",
    )
  })

  it("fbclid + utm juntos: arrastra ambos, fbclid primero", () => {
    setup("/?fbclid=XYZ&utm_source=fb&utm_medium=cpc&utm_campaign=promo")
    const out = withAdReturnLink("Hola")
    expect(out).toContain(
      "https://kunzera.com/reservar?fbclid=XYZ&utm_source=fb&utm_medium=cpc&utm_campaign=promo",
    )
  })

  it("visita con solo utm_medium/utm_campaign (sin utm_source ni fbclid): no toca el mensaje", () => {
    setup("/?utm_medium=cpc&utm_campaign=promo")
    expect(withAdReturnLink("Hola")).toBe("Hola")
  })

  // Caso "el link se arma mucho después, ya sin params en la URL": el utm
  // quedó en sessionStorage al cargar la página (captureUtm en main.tsx).
  it("utm en sessionStorage y URL ya limpia: igual arrastra el link", () => {
    const h = setup("/")
    h.sessionStore.set(
      "kz_utm_v1",
      JSON.stringify({ utm_source: "ig", utm_campaign: "reel" }),
    )
    const out = withAdReturnLink("Hola")
    expect(out).toContain(
      "https://kunzera.com/reservar?utm_source=ig&utm_campaign=reel",
    )
  })

  it("el param de la URL le gana al de sessionStorage", () => {
    const h = setup("/?utm_source=fb")
    h.sessionStore.set("kz_utm_v1", JSON.stringify({ utm_source: "ig" }))
    expect(withAdReturnLink("Hola")).toContain(
      "https://kunzera.com/reservar?utm_source=fb",
    )
  })
})

describe("DEEP_LINKS (referencia para pegar en los anuncios)", () => {
  it("usa los ids reales de los packs", () => {
    expect(DEEP_LINKS).toEqual({
      packs: "https://kunzera.com/packs",
      reservar: "https://kunzera.com/reservar",
      reservarPlatino: "https://kunzera.com/reservar/platino",
      reservarDiamante: "https://kunzera.com/reservar/diamante",
    })
  })
})
