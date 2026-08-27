const STORAGE_KEY = "kz_vid"

// ID propio y estable de este navegador. Se crea la primera vez que alguien
// entra y se guarda en localStorage (NO sessionStorage: tiene que sobrevivir
// a que la persona cierre la pestaña y vuelva días después). No es un dato
// personal — es un número al azar. Sirve como `external_id` para Meta: deja
// que reconozca que la visita anónima de hoy y una compra dentro de unos
// días son la misma persona, aunque en el medio se haya perdido la cookie
// del píxel (bloqueador, Safari/iOS).
//
// El script inline de index.html ya lo crea antes de que cargue el bundle y
// lo deja en window.__kunzeraVid (misma clave de localStorage). Acá se lee
// de ahí primero, con el get/create sobre localStorage como respaldo por si
// ese script no llegó a correr (tests, orden de carga raro).
export function getVisitorId(): string | undefined {
  const fromWindow = (window as unknown as { __kunzeraVid?: string }).__kunzeraVid
  if (fromWindow) return fromWindow
  try {
    let id = localStorage.getItem(STORAGE_KEY)
    if (!id) {
      id = genId()
      localStorage.setItem(STORAGE_KEY, id)
    }
    return id
  } catch {
    // localStorage no disponible (modo privado, storage bloqueado) — el
    // evento se manda igual, sólo que sin external_id.
    return undefined
  }
}

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  return "v-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2)
}
