import { getStore } from "@netlify/blobs"
import type { Order } from "../../src/types/order"

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
// Empieza siempre en modo "dev" (AFIPSDK_ENVIRONMENT=dev o sin configurar)
// — usa un CUIT y certificado de prueba compartidos por AfipSDK, no
// requiere nada de AFIP real. Recién con AFIPSDK_ENVIRONMENT=production
// (y AFIPSDK_CUIT/AFIPSDK_PUNTO_VENTA/AFIPSDK_CERT/AFIPSDK_KEY cargados)
// empieza a facturar de verdad. Ver plan para el detalle de cada campo.
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
// una respuesta colgada deja que Netlify mate la función de golpe (a los
// 60s, sin aviso limpio) en vez de que nuestro propio código se entere y
// pueda reaccionar. Con 3 llamadas seguidas como mucho (auth + numeración +
// FECAESolicitar), 15s cada una deja margen de sobra por debajo del límite
// de la plataforma.
const AFIP_FETCH_TIMEOUT_MS = 15000

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
  if (raw && raw !== "production" && raw !== "dev") {
    console.error(
      `[facturacion] AFIPSDK_ENVIRONMENT tiene un valor inesperado: "${raw}" — revisar la variable en Netlify. Se corta acá en vez de caer a modo dev en silencio.`,
    )
    return null
  }
  const environment = raw === "production" ? "production" : "dev"

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
// confiar en que la plataforma corte por nosotros. Si AFIP/AfipSDK se
// cuelga, preferimos enterarnos nosotros (con margen para reaccionar) antes
// que Netlify mate la función entera de golpe a los 60s.
async function fetchConTimeout(url: string, init: RequestInit, timeoutMs = AFIP_FETCH_TIMEOUT_MS): Promise<Response> {
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
// (60s para funciones sincrónicas como esta), así que si un claim sigue
// "en_proceso" pasados los 2 minutos, es seguro asumir que ese intento ya
// terminó (bien o mal) y no sigue corriendo en paralelo.
const CLAIM_TTL_MS = 2 * 60 * 1000

type InvoiceRecord =
  | { status: "en_proceso"; claimedAt: number }
  | { status: "facturada"; cae: string; numero: number }

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
async function markInvoiced(idempotencyKey: string, info: { cae: string; numero: number }): Promise<boolean> {
  try {
    const store = getStore(INVOICED_STORE)
    await store.setJSON(idempotencyKey, {
      status: "facturada",
      cae: info.cae,
      numero: info.numero,
    } satisfies InvoiceRecord)
    return true
  } catch (err) {
    console.error("[facturacion] no se pudo marcar como facturada:", err)
    return false
  }
}

// Hoy el sistema no guarda en ningún lado si una reserva se pagó por
// transferencia o por Binance (ambas comparten el mismo flujo hacia el
// Apps Script). Se etiqueta aparte vía tag-payment-method.mts. Si no hay
// etiqueta guardada (ej. la llamada de tag-payment-method falló), el
// default es tratarla como transferencia — preferible facturar de más
// una vez por accidente a perder silenciosamente una factura real.
export async function getPaymentMethod(idempotencyKey: string): Promise<"transferencia" | "binance"> {
  try {
    const store = getStore(METHOD_STORE)
    // consistency: "strong" — igual que alreadyInvoiced/alreadyProcessed en
    // mp-webhook.mts. Sin esto, una lectura eventualmente consistente podría
    // no ver todavía la etiqueta "binance" que tag-payment-method.mts acaba
    // de escribir, y facturar por default algo que no debería facturarse.
    const value = await store.get(idempotencyKey, { consistency: "strong" })
    return value === "binance" ? "binance" : "transferencia"
  } catch {
    return "transferencia"
  }
}

// Login contra AFIP (WSAA) a través de AfipSDK. Con el volumen bajo de
// Kunzera (~16 reservas/día) se pide un token nuevo en cada factura en vez
// de cachearlo — más simple, sin riesgo de usar un token vencido.
async function autenticar(creds: Credentials): Promise<{ token: string; sign: string } | null> {
  try {
    const res = await fetchConTimeout(`${API_BASE}/auth`, {
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
    })
    if (!res.ok) {
      console.error("[facturacion] fallo de autenticación AFIP:", res.status, await res.text().catch(() => ""))
      return null
    }
    const data = (await res.json()) as { token?: string; sign?: string }
    if (!data.token || !data.sign) return null
    return { token: data.token, sign: data.sign }
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
    const res = await fetchConTimeout(`${API_BASE}/requests`, {
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
    })
    if (!res.ok) {
      console.error("[facturacion] fallo HTTP consultando numeracion:", res.status, await res.text().catch(() => ""))
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

// Crea una Factura C a Consumidor Final por un servicio, por el monto de
// la reserva (siempre el precio base — $50.000/$70.000 — nunca el total
// con la comisión de Mercado Pago sumada, ver order.monto en mp-webhook).
async function crearFactura(order: InvoiceableOrder): Promise<FacturaResult> {
  const creds = credentials()
  if (!creds) return { ok: false, error: "not_configured" }

  const auth = await autenticar(creds)
  if (!auth) return { ok: false, error: "auth_fallida" }

  const numero = await siguienteNumero(creds, auth)
  if (!numero) return { ok: false, error: "no_numero" }

  const monto = Number(order.monto) || 0
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
    res = await fetchConTimeout(`${API_BASE}/requests`, {
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
    })
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
      return { ok: false, error: data.errors?.map((e) => e.msg).join(", ") || `http_${res.status}` }
    }

    const solicitudErrors = data.FECAESolicitarResult?.Errors?.Err
    if (solicitudErrors?.length) {
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
): Promise<void> {
  console.error(
    "[facturacion] CAE real emitido pero no se pudo guardar el registro — anotar a mano:",
    JSON.stringify({ idempotencyKey: order.idempotencykey, ...info }),
  )
  const webhookUrl = process.env.MP_DISCORD_WEBHOOK_URL
  if (!webhookUrl) return
  const content = [
    "🚨 **Factura generada en AFIP pero no se pudo guardar el registro acá adentro**",
    `${order.nombre || "-"} — ${order.plan || "-"} — $${order.monto || 0}`,
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
  | { ok: true; cae: string; numero: number; already: boolean }
  | { ok: false; error: string; ambiguous?: boolean }

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
      return { ok: true, cae: data.cae, numero: data.numero, already: true }
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
  // cargado, campo vacío) y no algo que AFIP deba ver.
  const monto = Number(order.monto)
  if (!Number.isFinite(monto) || monto <= 0) {
    await releaseClaim(idempotencyKey)
    return { ok: false, error: `monto_invalido (${order.monto})` }
  }

  const result = await crearFactura(order)
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
    return { ok: false, error: result.error, ambiguous: result.ambiguous }
  }

  const guardado = await markInvoiced(idempotencyKey, { cae: result.cae, numero: result.numero })
  if (!guardado) {
    // El CAE es real y válido igual — no le mentimos al admin diciendo que
    // falló — pero como no quedó guardado acá, avisamos fuerte por otro
    // canal para que no se pierda el dato.
    await alertarFacturaSinGuardar(order, { cae: result.cae, numero: result.numero })
  }
  return { ok: true, cae: result.cae, numero: result.numero, already: false }
}
