import { getStore } from "@netlify/blobs"
import type { Order } from "../../src/types/order"
import { mpTotal } from "../../../src/lib/pricing"

const INVOICED_STORE = "facturas-emitidas"
const METHOD_STORE = "payment-methods"

// Subconjunto mínimo de Order necesario para facturar — lo que manda el
// panel admin al apretar "Generar factura" (generar-factura.mts).
export type InvoiceableOrder = Pick<Order, "idempotencykey" | "nombre" | "plan" | "monto" | "turno">

// AfipSDK: https://docs.afipsdk.com — wrapper delgado sobre el web service
// real de AFIP (WSFEv1): habla en JSON en vez de SOAP/XML, pero los
// nombres de campo son los mismos que usa AFIP internamente. Credenciales
// como variables de entorno en Netlify, igual que MP_ACCESS_TOKEN.
//
// AFIPSDK_ENVIRONMENT tiene que decir explícitamente "dev" o "production"
// — no hay default implícito. Antes, si la variable no estaba seteada (no
// solo si tenía un valor con typo), el código caía en silencio a modo dev
// (CUIT y certificado de prueba compartidos por AfipSDK) y devolvía un CAE
// con pinta de real pero sin ningún valor legal, sin ningún aviso visible.
// Con la variable ya cargada en Netlify para production y para la branch,
// esto no debería dispararse nunca en un deploy real — pero si algún día
// esa variable se borra o queda sin scope por error, ahora se corta acá
// ("not_configured") en vez de facturar en silencio contra el sandbox.
// Para probar en local sin nada configurado: setear AFIPSDK_ENVIRONMENT=dev
// a mano en .env (opt-in explícito, ya no es el default).
const API_BASE = "https://app.afipsdk.com/api/v1/afip"
const DEV_CUIT = "20409378472" // CUIT de prueba compartido de AfipSDK (solo environment=dev)
const DEV_PUNTO_VENTA = 1

// Códigos fijos de AFIP para "Factura C a Consumidor Final por un
// servicio" (verificados contra la documentación oficial de AfipSDK/AFIP
// — ver plan):
const CBTE_TIPO_FACTURA_C = 11
const CONCEPTO_SERVICIOS = 2
const DOC_TIPO_CONSUMIDOR_FINAL = 99
const CONDICION_IVA_CONSUMIDOR_FINAL = 5

// Cada llamada a AFIP/AfipSDK tiene su propio límite de tiempo — sin esto,
// una respuesta colgada deja que Netlify mate la función de golpe, sin
// aviso limpio, en vez de que nuestro propio código se entere (fetchConTimeout
// más abajo) y pueda devolver un error prolijo. El plan actual de Netlify
// (Personal) corta funciones síncronas a los 10s reales — no a los 60s que
// decía un comentario viejo acá, ese número correspondía a un plan
// distinto. Con hasta 3 llamadas seguidas en el peor caso (auth + numeración
// + FECAESolicitar) y ~1.5s de margen para nuestro propio procesamiento
// (Blobs, JSON), el presupuesto total no puede pasar de ~8.5s para que
// nuestro propio timeout tenga chance de dispararse ANTES que el corte
// abrupto de la plataforma — si Netlify mata la función primero, se pierde
// la clasificación "ambiguous" y el admin ve un error de conexión genérico
// en vez del aviso claro de "revisá en AFIP antes de reintentar". Si algún
// día se sube a un plan con más margen (Pro: 26s), estos números se pueden
// relajar.
const AUTH_TIMEOUT_MS = 2500
const NUMERO_TIMEOUT_MS = 2500
const FECAE_TIMEOUT_MS = 3000 // la llamada que más importa — la que de verdad crea la factura

type FacturaResult =
  | { ok: true; cae: string; numero: number }
  // "ambiguous": no sabemos si AFIP llegó a procesar el pedido antes de que
  // se cortara la conexión — puede que haya un CAE real ya emitido del
  // otro lado que nunca llegamos a ver. Distinto de un rechazo limpio (ej.
  // autenticación fallida, AFIP dijo explícitamente que no): ver el uso de
  // este flag en invoiceOrderNow para por qué importa la diferencia.
  | { ok: false; error: string; ambiguous?: boolean }

type Credentials = {
  accessToken: string
  environment: "dev" | "production"
  cuit: string
  puntoVenta: number
  cert?: string
  key?: string
}

function credentials(): Credentials | null {
  const accessToken = process.env.AFIPSDK_ACCESS_TOKEN
  if (!accessToken) return null

  // Comparación exacta a propósito (con trim, por si Netlify guarda un
  // espacio o salto de línea de más al pegar el valor) — cualquier cosa
  // que no sea EXACTAMENTE "production" o "dev"/vacío se trata como
  // configuración rota y se corta acá, en vez de caer en silencio a modo
  // dev. Un typo tipo "Production" (mayúscula) antes pasaba desapercibido
  // y terminaba facturando contra el sandbox de prueba de AfipSDK con un
  // CAE con pinta de real pero sin ningún valor legal — sin ningún aviso
  // visible para el admin, solo un log que nadie lee.
  const raw = process.env.AFIPSDK_ENVIRONMENT?.trim()
  if (raw !== "production" && raw !== "dev") {
    console.error(
      `[facturacion] AFIPSDK_ENVIRONMENT debe ser exactamente "production" o "dev" — valor actual: ${
        raw ? `"${raw}"` : "(sin configurar)"
      }. Se corta acá en vez de caer a modo dev en silencio.`,
    )
    return null
  }
  const environment = raw

  if (environment === "dev") {
    return { accessToken, environment, cuit: DEV_CUIT, puntoVenta: DEV_PUNTO_VENTA }
  }

  const cuit = process.env.AFIPSDK_CUIT
  const puntoVentaRaw = process.env.AFIPSDK_PUNTO_VENTA
  const cert = process.env.AFIPSDK_CERT
  const key = process.env.AFIPSDK_KEY
  if (!cuit || !puntoVentaRaw || !cert || !key) return null

  const puntoVenta = Number(puntoVentaRaw)
  if (!Number.isFinite(puntoVenta) || puntoVenta <= 0) {
    console.error(`[facturacion] AFIPSDK_PUNTO_VENTA no es un número válido: "${puntoVentaRaw}"`)
    return null
  }

  return { accessToken, environment, cuit, puntoVenta, cert, key }
}

// El valor interno "production" (más legible en este archivo) no es el
// que espera la API de AfipSDK — confirmado a mano contra la API real:
// devuelve "El campo Ambiente es invalido" con "production", solo acepta
// "prod". "dev" sí coincide en los dos lados.
function apiEnvironment(environment: Credentials["environment"]): "dev" | "prod" {
  return environment === "production" ? "prod" : "dev"
}

// Igual que sendMetaPurchaseEvent en mp-webhook.mts y postJson/getJson en
// appsScript.ts — timeout explícito en cada llamada externa en vez de
// confiar en que la plataforma corte por nosotros. Sin timeoutMs explícito
// no hay default silencioso a propósito — cada call site de acá abajo pasa
// el suyo (AUTH/NUMERO/FECAE_TIMEOUT_MS), para que la suma total quede
// dentro del presupuesto real de la función (ver comentario arriba).
async function fetchConTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// Netlify Blobs (esta versión del SDK, confirmado leyendo el paquete
// instalado) no tiene ninguna operación atómica tipo "set solo si no
// existe" — así que no hay forma de "reservar" un idempotencyKey de forma
// perfectamente segura antes de facturar. Como mitigación (no una solución
// perfecta): se guarda un "en_proceso" con timestamp ANTES de llamar a AFIP,
// apenas confirmada la lectura de invoiceState — no después de chequear
// método de pago o validar el monto, para que la ventana entre "leído como
// libre" y "reservado" sea lo más chica posible (ver invoiceOrderNow). Un
// claim de más de CLAIM_TTL_MS se considera abandonado (la función que lo
// dejó ahí se cortó a mitad de camino) y se permite reintentar — 2 minutos
// da margen de sobra por encima del límite real de ejecución de Netlify
// (10s en el plan actual — ver AUTH/NUMERO/FECAE_TIMEOUT_MS más arriba),
// así que si un claim sigue
// "en_proceso" pasados los 2 minutos, es seguro asumir que ese intento ya
// terminó (bien o mal) y no sigue corriendo en paralelo.
const CLAIM_TTL_MS = 2 * 60 * 1000

type InvoiceRecord =
  | { status: "en_proceso"; claimedAt: number }
  | { status: "facturada"; cae: string; numero: number; monto: number }

async function invoiceState(
  idempotencyKey: string,
): Promise<{ ya: true } | { ya: false; ocupado: boolean }> {
  try {
    const store = getStore(INVOICED_STORE)
    const data = (await store.get(idempotencyKey, {
      type: "json",
      consistency: "strong",
    })) as InvoiceRecord | null
    if (!data) return { ya: false, ocupado: false }
    if (data.status === "facturada") return { ya: true }
    // "en_proceso": ocupado solo si el claim es reciente — uno viejo es de
    // un intento anterior que se cortó, no bloquea el reintento.
    const ocupado = Date.now() - data.claimedAt < CLAIM_TTL_MS
    return { ya: false, ocupado }
  } catch {
    return { ya: false, ocupado: false }
  }
}

async function claim(idempotencyKey: string): Promise<void> {
  try {
    const store = getStore(INVOICED_STORE)
    await store.setJSON(idempotencyKey, { status: "en_proceso", claimedAt: Date.now() } satisfies InvoiceRecord)
  } catch (err) {
    console.error("[facturacion] no se pudo reservar la facturación:", err)
  }
}

// A diferencia del viejo diseño (reintento automático cada ~15 min sin que
// nadie mire), acá el admin ve el error al toque y puede querer reintentar
// enseguida. Si crearFactura ya devolvió un resultado DEFINITIVO (la
// ejecución terminó y AFIP contestó con claridad que no se generó nada), no
// tiene sentido dejarlo "en_proceso" 2 minutos más — lo liberamos así el
// próximo click no choca con el mensaje confuso de "ya se está generando".
// OJO: esto NO se llama cuando el resultado es "ambiguous" — ver
// invoiceOrderNow para por qué en ese caso el claim se deja vivo a
// propósito.
async function releaseClaim(idempotencyKey: string): Promise<void> {
  try {
    const store = getStore(INVOICED_STORE)
    await store.delete(idempotencyKey)
  } catch (err) {
    console.error("[facturacion] no se pudo liberar la reserva de facturación:", err)
  }
}

export async function alreadyInvoiced(idempotencyKey: string): Promise<boolean> {
  const state = await invoiceState(idempotencyKey)
  return state.ya
}

// Devuelve si la escritura realmente se guardó — si esto falla justo
// después de conseguir un CAE real, es la situación más peligrosa de todo
// este archivo (una factura real que queda sin ningún rastro acá adentro,
// con riesgo de facturarse de nuevo más adelante creyendo que nunca se
// hizo). invoiceOrderNow manda una alerta a Discord si esto devuelve false.
async function markInvoiced(
  idempotencyKey: string,
  info: { cae: string; numero: number; monto: number },
): Promise<boolean> {
  try {
    const store = getStore(INVOICED_STORE)
    await store.setJSON(idempotencyKey, {
      status: "facturada",
      cae: info.cae,
      numero: info.numero,
      monto: info.monto,
    } satisfies InvoiceRecord)
    return true
  } catch (err) {
    console.error("[facturacion] no se pudo marcar como facturada:", err)
    return false
  }
}

// Hoy el sistema no guarda en la reserva misma si se pagó por
// transferencia, Binance o Mercado Pago — se etiqueta aparte, en este
// mismo store, por dos caminos distintos: tag-payment-method.mts (llamado
// por el cliente, para transferencia/binance) y mp-webhook.mts (server-side,
// automático, para mercadopago — ver ahí). Si no hay etiqueta guardada (ej.
// la llamada de tag-payment-method falló, o es una reserva vieja de antes
// de este sistema), el default es tratarla como transferencia — preferible
// facturar de más por el precio base una vez por accidente a perder
// silenciosamente una factura real.
export async function getPaymentMethod(
  idempotencyKey: string,
): Promise<"transferencia" | "binance" | "mercadopago"> {
  try {
    const store = getStore(METHOD_STORE)
    // consistency: "strong" — igual que alreadyInvoiced/alreadyProcessed en
    // mp-webhook.mts. Sin esto, una lectura eventualmente consistente podría
    // no ver todavía la etiqueta que tag-payment-method.mts/mp-webhook.mts
    // acaban de escribir, y facturar por default algo que no debería
    // facturarse (binance) o por el monto equivocado (mercadopago).
    const value = await store.get(idempotencyKey, { consistency: "strong" })
    if (value === "binance") return "binance"
    if (value === "mercadopago") return "mercadopago"
    return "transferencia"
  } catch {
    return "transferencia"
  }
}

// El ticket de acceso que devuelve WSAA (el login real de AFIP, detrás de
// este /auth de AfipSDK) es válido 12hs del lado de AFIP — no hace falta
// pedir uno nuevo en cada factura. Se cachea acá (Netlify Blobs, mismo
// patrón que el resto del archivo) con un TTL bien por debajo de esas 12hs
// reales (AFIP puede cambiar esa duración sin aviso, según su propia
// documentación — mejor quedarse corto que quedarse con un ticket vencido).
// Esto saca una llamada entera de la cadena secuencial en el caso común
// (ver AUTH/NUMERO/FECAE_TIMEOUT_MS más arriba, por qué importa el total).
const AUTH_CACHE_STORE = "afip-auth-cache"
const AUTH_CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6hs — la mitad de las 12hs reales, con margen de sobra

type CachedAuth = { token: string; sign: string; cachedAt: number }

async function authCacheGet(cuit: string): Promise<{ token: string; sign: string } | null> {
  try {
    const store = getStore(AUTH_CACHE_STORE)
    const cached = (await store.get(cuit, { type: "json", consistency: "strong" })) as CachedAuth | null
    if (!cached || Date.now() - cached.cachedAt >= AUTH_CACHE_TTL_MS) return null
    return { token: cached.token, sign: cached.sign }
  } catch {
    return null
  }
}

async function authCacheSet(cuit: string, auth: { token: string; sign: string }): Promise<void> {
  try {
    await getStore(AUTH_CACHE_STORE).setJSON(cuit, { ...auth, cachedAt: Date.now() } satisfies CachedAuth)
  } catch (err) {
    // No es grave — simplemente se pierde el ahorro de esta vez, la próxima
    // factura vuelve a autenticar contra AFIP como si no hubiera caché.
    console.error("[facturacion] no se pudo cachear el ticket de AFIP:", err)
  }
}

// Si un llamado posterior (numeración o FECAESolicitar) rechaza con un
// ticket cacheado, lo más seguro es asumir que puede estar vencido/inválido
// y descartarlo — así el próximo intento (retry del admin, o la próxima
// reserva) arranca con un login fresco en vez de repetir el mismo fallo.
async function authCacheInvalidate(cuit: string): Promise<void> {
  try {
    await getStore(AUTH_CACHE_STORE).delete(cuit)
  } catch {
    // noop
  }
}

async function autenticar(creds: Credentials): Promise<{ token: string; sign: string } | null> {
  const cached = await authCacheGet(creds.cuit)
  if (cached) return cached

  try {
    const res = await fetchConTimeout(
      `${API_BASE}/auth`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${creds.accessToken}`,
        },
        body: JSON.stringify({
          environment: apiEnvironment(creds.environment),
          tax_id: creds.cuit,
          wsid: "wsfe",
          ...(creds.environment === "production" ? { cert: creds.cert, key: creds.key } : {}),
        }),
      },
      AUTH_TIMEOUT_MS,
    )
    if (!res.ok) {
      console.error("[facturacion] fallo de autenticación AFIP:", res.status, await res.text().catch(() => ""))
      return null
    }
    const data = (await res.json()) as { token?: string; sign?: string }
    if (!data.token || !data.sign) return null
    const auth = { token: data.token, sign: data.sign }
    await authCacheSet(creds.cuit, auth)
    return auth
  } catch (err) {
    console.error("[facturacion] error de red autenticando con AFIP:", err)
    return null
  }
}

// Pregunta a AFIP (vía FECompUltimoAutorizado) cuál fue el último número
// autorizado para este punto de venta + tipo de comprobante, para no
// pisar la numeración real.
async function siguienteNumero(
  creds: Credentials,
  auth: { token: string; sign: string },
): Promise<number | null> {
  try {
    const res = await fetchConTimeout(
      `${API_BASE}/requests`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${creds.accessToken}`,
        },
        body: JSON.stringify({
          environment: apiEnvironment(creds.environment),
          method: "FECompUltimoAutorizado",
          wsid: "wsfe",
          params: {
            Auth: { Token: auth.token, Sign: auth.sign, Cuit: creds.cuit },
            PtoVta: creds.puntoVenta,
            CbteTipo: CBTE_TIPO_FACTURA_C,
          },
        }),
      },
      NUMERO_TIMEOUT_MS,
    )
    if (!res.ok) {
      console.error("[facturacion] fallo HTTP consultando numeracion:", res.status, await res.text().catch(() => ""))
      if (res.status === 401 || res.status === 403) await authCacheInvalidate(creds.cuit)
      return null
    }
    // AfipSDK envuelve la respuesta real de AFIP en "<Metodo>Result" — no
    // devuelve los campos sueltos en la raíz (confirmado a mano contra su
    // API real, no solo contra la documentación). Importante: AFIP informa
    // sus propios errores (ej. "punto de venta no habilitado") CON HTTP 200,
    // adentro de "Errors.Err" — no alcanza con mirar el status HTTP. Sin
    // este chequeo, un error real de AFIP pasaba desapercibido y el código
    // seguía de largo con un CbteNro basura (confirmado a mano contra la
    // API real, forzando un punto de venta inválido a propósito).
    const data = (await res.json()) as {
      FECompUltimoAutorizadoResult?: {
        CbteNro?: number | string
        Errors?: { Err?: { Code?: number; Msg?: string }[] }
      }
    }
    const errors = data.FECompUltimoAutorizadoResult?.Errors?.Err
    if (errors?.length) {
      console.error("[facturacion] AFIP rechazó la consulta de numeración:", JSON.stringify(errors))
      // No distinguimos acá si el rechazo fue por el ticket cacheado
      // específicamente o por otra razón — invalidar de más solo cuesta un
      // login extra en el próximo intento, invalidar de menos podría dejar
      // reintentando con el mismo ticket roto varias veces seguidas.
      await authCacheInvalidate(creds.cuit)
      return null
    }
    const cbteNro = data.FECompUltimoAutorizadoResult?.CbteNro
    if (cbteNro === undefined) return null
    return Number(cbteNro) + 1
  } catch (err) {
    console.error("[facturacion] no se pudo consultar la numeración:", err)
    return null
  }
}

function fechaAfip(d = new Date()): number {
  // AFIP quiere las fechas como AAAAMMDD (número), en huso horario Argentina.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })
    .format(d)
    .split("-")
  return Number(parts.join(""))
}

// Crea una Factura C a Consumidor Final por un servicio, por
// montoFacturar — NO necesariamente order.monto: el contador confirmó
// (2026-08-04) que hay que facturar lo que el cliente efectivamente pagó,
// no el precio base que Kunzera termina recibiendo neto. Para transferencia
// y binance ambos coinciden (sin comisión), pero para Mercado Pago el
// cliente paga el total con la comisión de MP sumada (mpTotal) — es
// invoiceOrderNow quien decide cuál de los dos corresponde, según
// getPaymentMethod.
async function crearFactura(order: InvoiceableOrder, montoFacturar: number): Promise<FacturaResult> {
  const creds = credentials()
  if (!creds) return { ok: false, error: "not_configured" }

  const auth = await autenticar(creds)
  if (!auth) return { ok: false, error: "auth_fallida" }

  const numero = await siguienteNumero(creds, auth)
  if (!numero) return { ok: false, error: "no_numero" }

  const monto = montoFacturar
  const fecha = fechaAfip()

  // A partir de acá (la llamada a FECAESolicitar en sí) es la única parte
  // de todo el proceso donde un fallo es "ambiguo": si la conexión se corta
  // ANTES de que AFIP reciba el pedido, no pasó nada. Pero si se corta
  // DESPUÉS de que AFIP ya lo procesó y emitió un CAE real, y la respuesta
  // nunca nos llega (timeout, corte de red, la función de Netlify muere a
  // mitad de camino), quedaríamos sin enterarnos de que ese CAE existe —
  // y reintentar más tarde generaría una segunda factura real de verdad,
  // sin que quede ningún rastro de la primera acá adentro. Por eso este
  // catch específico se marca "ambiguous: true", y NO se libera el claim
  // en invoiceOrderNow para este caso: preferimos frenar 2 minutos (y que
  // el admin pueda ir a chequear en su cuenta de AFIP) antes que arriesgar
  // una segunda factura real por reintentar a ciegas.
  let res: Response
  try {
    res = await fetchConTimeout(
      `${API_BASE}/requests`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${creds.accessToken}`,
        },
        body: JSON.stringify({
          environment: apiEnvironment(creds.environment),
          method: "FECAESolicitar",
          wsid: "wsfe",
          params: {
            Auth: { Token: auth.token, Sign: auth.sign, Cuit: creds.cuit },
            FeCAEReq: {
              FeCabReq: { CantReg: 1, PtoVta: creds.puntoVenta, CbteTipo: CBTE_TIPO_FACTURA_C },
              FeDetReq: {
                FECAEDetRequest: {
                  Concepto: CONCEPTO_SERVICIOS,
                  DocTipo: DOC_TIPO_CONSUMIDOR_FINAL,
                  DocNro: 0,
                  CbteDesde: numero,
                  CbteHasta: numero,
                  CbteFch: fecha,
                  // Obligatorios porque Concepto=2 (servicios). Se usa la
                  // fecha del pago (no la del turno, que puede ser futura).
                  FchServDesde: fecha,
                  FchServHasta: fecha,
                  FchVtoPago: fecha,
                  ImpTotal: monto,
                  ImpTotConc: 0,
                  ImpNeto: monto,
                  ImpOpEx: 0,
                  ImpIVA: 0,
                  ImpTrib: 0,
                  MonId: "PES",
                  MonCotiz: 1,
                  CondicionIVAReceptorId: CONDICION_IVA_CONSUMIDOR_FINAL,
                },
              },
            },
          },
        }),
      },
      FECAE_TIMEOUT_MS,
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[facturacion] conexión incierta con AFIP en FECAESolicitar (puede haberse generado igual):", msg)
    return { ok: false, error: msg, ambiguous: true }
  }

  // A partir de acá SÍ tenemos una respuesta HTTP concreta de AfipSDK — un
  // res.json() roto o un error explícito de AFIP son resultados DEFINITIVOS
  // (sabemos con certeza que no se emitió CAE), no ambiguos.
  try {
    const data = (await res.json()) as {
      errors?: { code?: string; msg?: string }[]
      // AfipSDK envuelve la respuesta real de AFIP en "FECAESolicitarResult"
      // — confirmado a mano contra su API real, no solo contra la
      // documentación. AFIP informa sus propios errores CON HTTP 200,
      // adentro de "Errors.Err" — el chequeo de "!res.ok" de más abajo NO
      // los detecta por sí solo (confirmado a mano forzando un error real).
      FECAESolicitarResult?: {
        Errors?: { Err?: { Code?: number; Msg?: string }[] }
        FeDetResp?: {
          FECAEDetResponse?: { Resultado?: string; CAE?: string; Observaciones?: unknown }[]
        }
      }
    }

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) await authCacheInvalidate(creds.cuit)
      return { ok: false, error: data.errors?.map((e) => e.msg).join(", ") || `http_${res.status}` }
    }

    const solicitudErrors = data.FECAESolicitarResult?.Errors?.Err
    if (solicitudErrors?.length) {
      // Mismo criterio que en siguienteNumero: no distinguimos la causa
      // exacta del rechazo, invalidar el ticket cacheado de más es barato.
      await authCacheInvalidate(creds.cuit)
      return {
        ok: false,
        error: solicitudErrors.map((e) => `${e.Code}: ${e.Msg}`).join(", "),
      }
    }

    const detalle = data.FECAESolicitarResult?.FeDetResp?.FECAEDetResponse?.[0]
    const cae = detalle?.CAE
    if (!cae || detalle?.Resultado !== "A") {
      const obs = detalle?.Observaciones ? JSON.stringify(detalle.Observaciones) : undefined
      return {
        ok: false,
        error: data.errors?.map((e) => e.msg).join(", ") || obs || "sin_cae_en_respuesta",
      }
    }

    return { ok: true, cae, numero }
  } catch (err) {
    // res.json() en sí tiró (cuerpo no-JSON: página de error HTML, cuerpo
    // vacío, etc). Tuvimos un HTTP status pero no pudimos leer qué decía —
    // no es tan ambiguo como un corte de red (AFIP sí respondió algo), pero
    // tampoco es una respuesta que podamos interpretar con confianza. Se
    // trata como ambiguo por las dudas: mejor frenar y que el admin
    // verifique a mano que reintentar a ciegas y arriesgar una duplicada.
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[facturacion] respuesta de AFIP no se pudo interpretar:", res.status, msg)
    return { ok: false, error: msg, ambiguous: true }
  }
}

// Aviso urgente para el único escenario realmente peligroso de todo este
// archivo: se consiguió un CAE real de AFIP, pero no se pudo guardar el
// registro localmente (Netlify Blobs falló justo en ese momento). Sin este
// aviso, esa factura queda sin ningún rastro acá adentro y el sistema
// podría facturar de nuevo esa misma reserva más adelante creyendo que
// nunca se facturó. Si no está configurado MP_DISCORD_WEBHOOK_URL, no
// manda nada — pero igual queda en los logs de la función.
async function alertarFacturaSinGuardar(
  order: InvoiceableOrder,
  info: { cae: string; numero: number },
  montoFacturado: number,
): Promise<void> {
  console.error(
    "[facturacion] CAE real emitido pero no se pudo guardar el registro — anotar a mano:",
    JSON.stringify({ idempotencyKey: order.idempotencykey, montoFacturado, ...info }),
  )
  const webhookUrl = process.env.MP_DISCORD_WEBHOOK_URL
  if (!webhookUrl) return
  const content = [
    "🚨 **Factura generada en AFIP pero no se pudo guardar el registro acá adentro**",
    // montoFacturado, no order.monto — para Mercado Pago no son lo mismo
    // (ver invoiceOrderNow), y es lo que hay que buscar en AFIP.
    `${order.nombre || "-"} — ${order.plan || "-"} — $${montoFacturado}`,
    `CAE: ${info.cae} — Número: ${info.numero}`,
    `ID interno: ${(order.idempotencykey || "-").slice(0, 8)}…`,
    "IMPORTANTE: anotá este CAE a mano — el sistema no tiene registro de que esta reserva ya se facturó, así que si volvés a apretar \"Generar factura\" acá podría generarse una SEGUNDA factura real. No reintentes sin revisar antes.",
  ].join("\n")
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    })
  } catch (err) {
    console.error("[facturacion] no se pudo avisar a Discord del registro perdido:", err)
  }
}

// Resultado que ve el panel admin al apretar "Generar factura" — a
// diferencia del viejo invoiceOrderIfNeeded (void, silencioso, pensado
// para disparadores automáticos), acá el admin necesita saber exactamente
// qué pasó para decidir si reintentar o revisar a mano.
export type InvoiceOutcome =
  // monto: el que efectivamente se facturó (puede ser distinto de
  // order.monto para Mercado Pago, ver invoiceOrderNow) — así el panel
  // admin puede mostrarlo y no depender de comparar a ciegas contra AFIP.
  | { ok: true; cae: string; numero: number; already: boolean; monto: number }
  // monto: el que efectivamente se intentó facturar — solo presente cuando
  // se llegó a decidir un monto, para que el admin sepa exactamente qué
  // buscar en su cuenta de AFIP si el resultado fue "ambiguous".
  | { ok: false; error: string; ambiguous?: boolean; monto?: number }

// Punto de entrada único de facturación — usado por generar-factura.mts
// cuando el admin aprieta "Generar factura" a mano en el panel. No hay
// ningún disparador automático: Kunzera factura reserva por reserva,
// cuando el admin decide (a propósito, para no arriesgar una factura mal
// hecha mientras nadie está mirando — ver historial del proyecto).
export async function invoiceOrderNow(order: InvoiceableOrder): Promise<InvoiceOutcome> {
  const idempotencyKey = order.idempotencykey
  if (!idempotencyKey) return { ok: false, error: "missing_idempotency_key" }

  if (!credentials()) return { ok: false, error: "not_configured" }

  const state = await invoiceState(idempotencyKey)
  if (state.ya) {
    // Ya facturada antes (posible reintento del mismo click, o el admin
    // reabrió el detalle) — recuperamos el CAE guardado en vez de facturar
    // de nuevo. Esto es lo que garantiza que no se pueda duplicar una
    // factura por doble click o por volver a abrir la reserva.
    const store = getStore(INVOICED_STORE)
    const data = (await store.get(idempotencyKey, {
      type: "json",
      consistency: "strong",
    })) as InvoiceRecord | null
    if (data?.status === "facturada") {
      // data.monto puede faltar en registros guardados ANTES de que este
      // campo existiera (ver markInvoiced) — para esos, order.monto es lo
      // mejor que tenemos (puede no ser el monto real facturado si era una
      // reserva de Mercado Pago, pero es mejor que no mostrar nada).
      return { ok: true, cae: data.cae, numero: data.numero, already: true, monto: data.monto ?? order.monto }
    }
    // Caso rarísimo (dos lecturas "strong" del mismo dato discreparon) —
    // invoiceState() ya vio "facturada" hace un instante, así que sabemos
    // con certeza que esto YA se facturó (no es un caso "ambiguous" — ese
    // flag es para cuando no sabemos qué pasó, acá sí sabemos). Mensaje
    // específico en vez del genérico de conexión incierta.
    return { ok: false, error: "ya_facturada_no_reintentar" }
  }
  if (state.ocupado) return { ok: false, error: "ya_se_esta_facturando" }

  // Reservamos el idempotencyKey apenas confirmamos que está libre — ANTES
  // de chequear método de pago o validar el monto — para que la ventana
  // entre "leído como libre" y "reservado" sea la más chica posible (ver
  // comentario largo en la sección de arriba). Si alguno de los chequeos
  // de acá abajo corta el flujo, se libera el claim enseguida.
  await claim(idempotencyKey)

  const metodo = await getPaymentMethod(idempotencyKey)
  if (metodo === "binance") {
    await releaseClaim(idempotencyKey)
    return { ok: false, error: "binance_no_facturable" }
  }

  // Un monto en $0 (o inválido) no debería generar una Factura C real por
  // $0 — casi seguro es un dato roto de la reserva (plan sin precio
  // cargado, campo vacío) y no algo que AFIP deba ver. Se valida sobre el
  // precio base (order.monto) porque es lo que llega del front — si es
  // inválido, tampoco tiene sentido derivar montoFacturar de él.
  const montoBase = Number(order.monto)
  if (!Number.isFinite(montoBase) || montoBase <= 0) {
    await releaseClaim(idempotencyKey)
    return { ok: false, error: `monto_invalido (${order.monto})` }
  }

  // El contador confirmó (2026-08-04): hay que facturar lo que el cliente
  // efectivamente pagó, no el precio base que Kunzera recibe neto. Para
  // transferencia eso YA es order.monto (sin comisión). Para Mercado Pago,
  // el cliente pagó mpTotal(monto) — la comisión de MP la absorbe Kunzera,
  // pero ante AFIP la factura tiene que reflejar el cobro real.
  const montoFacturar = metodo === "mercadopago" ? mpTotal(montoBase) : montoBase

  const result = await crearFactura(order, montoFacturar)
  if (!result.ok) {
    console.error("[facturacion] no se pudo facturar", idempotencyKey, result.error, result.ambiguous ? "(ambiguo)" : "")
    if (!result.ambiguous) {
      // Fallo limpio y definitivo (AFIP dijo que no, o ni siquiera llegamos
      // a llamarlo) — seguro reintentar ya mismo.
      await releaseClaim(idempotencyKey)
    }
    // Si es ambiguo, el claim se deja "en_proceso" a propósito — expira
    // solo a los 2 minutos, dándole tiempo al admin de revisar en AFIP
    // antes de que el sistema permita un reintento.
    return { ok: false, error: result.error, ambiguous: result.ambiguous, monto: montoFacturar }
  }

  const guardado = await markInvoiced(idempotencyKey, { cae: result.cae, numero: result.numero, monto: montoFacturar })
  if (!guardado) {
    // El CAE es real y válido igual — no le mentimos al admin diciendo que
    // falló — pero como no quedó guardado acá, avisamos fuerte por otro
    // canal para que no se pierda el dato.
    await alertarFacturaSinGuardar(order, { cae: result.cae, numero: result.numero }, montoFacturar)
  }
  return { ok: true, cae: result.cae, numero: result.numero, already: false, monto: montoFacturar }
}
