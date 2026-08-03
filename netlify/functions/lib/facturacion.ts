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

type FacturaResult = { ok: true; cae: string; numero: number } | { ok: false; error: string }

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

  // Comparación exacta a propósito, pero con un chequeo aparte para
  // cualquier valor que no sea ni "production" ni vacío/"dev" — ya
  // aparecieron hoy dos bugs de "string casi correcto pero no exacto"
  // (ver "production" vs "prod" más abajo), así que un typo o un espacio
  // de más al cargar la variable en Netlify no debe caer en silencio a
  // modo dev sin que nadie se entere.
  const raw = process.env.AFIPSDK_ENVIRONMENT
  if (raw && raw !== "production" && raw !== "dev") {
    console.error(`[facturacion] AFIPSDK_ENVIRONMENT tiene un valor inesperado: "${raw}" — revisar la variable en Netlify`)
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
  return { accessToken, environment, cuit, puntoVenta: Number(puntoVentaRaw), cert, key }
}

// El valor interno "production" (más legible en este archivo) no es el
// que espera la API de AfipSDK — confirmado a mano contra la API real:
// devuelve "El campo Ambiente es invalido" con "production", solo acepta
// "prod". "dev" sí coincide en los dos lados.
function apiEnvironment(environment: Credentials["environment"]): "dev" | "prod" {
  return environment === "production" ? "prod" : "dev"
}

// Netlify Blobs (esta versión del SDK) no tiene ninguna operación atómica
// tipo "set solo si no existe" — así que no hay forma de "reservar" un
// idempotencyKey de forma perfectamente segura antes de facturar. Como
// mitigación (no una solución perfecta): se guarda un "en_proceso" con
// timestamp ANTES de llamar a AFIP, no solo el resultado final después.
// Esto reduce la ventana real de doble factura de "toda la llamada a AFIP
// completa" (varios segundos) a la fracción de segundo entre la lectura y
// la escritura del claim — no la elimina del todo, pero la achica mucho.
// Un claim de más de CLAIM_TTL_MS se considera abandonado (la función que
// lo dejó ahí se cortó a mitad de camino) y se permite reintentar.
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
// enseguida. Si crearFactura ya devolvió un resultado (la ejecución
// terminó, no se cortó a mitad de camino), no tiene sentido dejarlo
// "en_proceso" 2 minutos más — lo liberamos así el próximo click no choca
// con el mensaje confuso de "ya se está generando".
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

async function markInvoiced(idempotencyKey: string, info: { cae: string; numero: number }): Promise<void> {
  try {
    const store = getStore(INVOICED_STORE)
    await store.setJSON(idempotencyKey, {
      status: "facturada",
      cae: info.cae,
      numero: info.numero,
    } satisfies InvoiceRecord)
  } catch (err) {
    console.error("[facturacion] no se pudo marcar como facturada:", err)
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
    const res = await fetch(`${API_BASE}/auth`, {
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
    const res = await fetch(`${API_BASE}/requests`, {
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

  try {
    const res = await fetch(`${API_BASE}/requests`, {
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
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}

// Resultado que ve el panel admin al apretar "Generar factura" — a
// diferencia del viejo invoiceOrderIfNeeded (void, silencioso, pensado
// para disparadores automáticos), acá el admin necesita saber exactamente
// qué pasó para decidir si reintentar o revisar a mano.
export type InvoiceOutcome =
  | { ok: true; cae: string; numero: number; already: boolean }
  | { ok: false; error: string }

// Punto de entrada único de facturación — usado por generar-factura.mts
// cuando el admin aprieta "Generar factura" a mano en el panel. No hay
// ningún disparador automático: Kunzera factura reserva por reserva,
// cuando el admin decide (a propósito, para no arriesgar una factura mal
// hecha mientras nadie está mirando — ver historial del proyecto).
export async function invoiceOrderNow(order: InvoiceableOrder): Promise<InvoiceOutcome> {
  const idempotencyKey = order.idempotencykey
  if (!idempotencyKey) return { ok: false, error: "missing_idempotency_key" }

  if (!credentials()) return { ok: false, error: "not_configured" }

  const metodo = await getPaymentMethod(idempotencyKey)
  if (metodo === "binance") return { ok: false, error: "binance_no_facturable" }

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
    return { ok: false, error: "estado_inconsistente" }
  }
  if (state.ocupado) return { ok: false, error: "ya_se_esta_facturando" }

  // Un monto en $0 (o inválido) no debería generar una Factura C real por
  // $0 — casi seguro es un dato roto de la reserva (plan sin precio
  // cargado, campo vacío) y no algo que AFIP deba ver.
  const monto = Number(order.monto)
  if (!Number.isFinite(monto) || monto <= 0) {
    return { ok: false, error: `monto_invalido (${order.monto})` }
  }

  // Reservamos el idempotencyKey ANTES de llamar a AFIP (ver comentario en
  // invoiceState/claim) — achica la ventana en la que dos clicks casi
  // simultáneos podrían facturar la misma reserva dos veces.
  await claim(idempotencyKey)

  const result = await crearFactura(order)
  if (!result.ok) {
    console.error("[facturacion] no se pudo facturar", idempotencyKey, result.error)
    await releaseClaim(idempotencyKey)
    return { ok: false, error: result.error }
  }

  await markInvoiced(idempotencyKey, { cae: result.cae, numero: result.numero })
  return { ok: true, cae: result.cae, numero: result.numero, already: false }
}
