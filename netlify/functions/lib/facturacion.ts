import { getStore } from "@netlify/blobs"
import type { Order } from "../../src/types/order"

const INVOICED_STORE = "facturas-emitidas"
const METHOD_STORE = "payment-methods"
const ALERTED_STORE = "facturacion-alertada"

// Subconjunto mínimo de Order necesario para facturar — así tanto
// mp-webhook.mts (que no tiene un Order completo a mano, solo los datos que
// mandó como metadata de la preferencia) como facturar-pendientes.mts (que
// sí tiene el Order completo desde getOrders) pueden llamar a esto mismo.
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

  const environment = process.env.AFIPSDK_ENVIRONMENT === "production" ? "production" : "dev"

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

export async function alreadyInvoiced(idempotencyKey: string): Promise<boolean> {
  try {
    const store = getStore(INVOICED_STORE)
    return (await store.get(idempotencyKey, { consistency: "strong" })) !== null
  } catch {
    return false
  }
}

async function markInvoiced(idempotencyKey: string, info: { cae: string; numero: number }): Promise<void> {
  try {
    const store = getStore(INVOICED_STORE)
    await store.setJSON(idempotencyKey, info)
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
    const value = await store.get(idempotencyKey)
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
    if (!res.ok) return null
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

// Evita mandar el mismo aviso de "no se pudo facturar" en cada reintento
// — facturar-pendientes corre cada ~15 min y reintenta solo (a propósito,
// no se marca como facturada en un fallo), así que sin este freno un
// problema persistente mandaría un mensaje nuevo a Discord cada 15
// minutos para siempre. Mismo patrón que ya usa mp-webhook.mts.
async function alreadyAlerted(idempotencyKey: string): Promise<boolean> {
  try {
    const store = getStore(ALERTED_STORE)
    return (await store.get(idempotencyKey, { consistency: "strong" })) !== null
  } catch {
    return false
  }
}

async function markAlerted(idempotencyKey: string): Promise<void> {
  try {
    const store = getStore(ALERTED_STORE)
    await store.set(idempotencyKey, "1")
  } catch (err) {
    console.error("[facturacion] no se pudo marcar la alerta como enviada:", err)
  }
}

// Aviso para CUALQUIER motivo por el que un pago se acredite pero la
// factura no se llegue a generar. Si no está configurado
// MP_DISCORD_WEBHOOK_URL, no manda nada.
async function notifyInvoiceFailed(order: InvoiceableOrder, reason: string): Promise<void> {
  const webhookUrl = process.env.MP_DISCORD_WEBHOOK_URL
  if (!webhookUrl) return

  const idempotencyKey = order.idempotencykey || "-"
  if (await alreadyAlerted(idempotencyKey)) return

  const content = [
    "⚠️ **No se pudo generar la factura digital de una reserva**",
    `${order.nombre || "-"} — ${order.plan || "-"} — $${order.monto || 0}`,
    `Motivo: ${reason}`,
    `ID interno: ${idempotencyKey.slice(0, 8)}…`,
    "Se va a reintentar solo en el próximo ciclo. Si se repite, revisar a mano.",
  ].join("\n")

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    })
    await markAlerted(idempotencyKey)
  } catch (err) {
    console.error("[facturacion] no se pudo avisar el fallo a Discord:", err)
  }
}

// Punto de entrada único, usado tanto por mp-webhook.mts (al confirmarse un
// pago de Mercado Pago) como por facturar-pendientes.mts (escaneo
// periódico para transferencia, y red de respaldo para Mercado Pago).
export async function invoiceOrderIfNeeded(order: InvoiceableOrder): Promise<void> {
  const idempotencyKey = order.idempotencykey
  if (!idempotencyKey) return

  if (!credentials()) return // facturación todavía no configurada: no-op silencioso

  const metodo = await getPaymentMethod(idempotencyKey)
  if (metodo === "binance") return

  if (await alreadyInvoiced(idempotencyKey)) return

  const result = await crearFactura(order)
  if (!result.ok) {
    console.error("[facturacion] no se pudo facturar", idempotencyKey, result.error)
    await notifyInvoiceFailed(order, result.error)
    return // sin marcar: el próximo ciclo de facturar-pendientes reintenta solo
  }

  await markInvoiced(idempotencyKey, { cae: result.cae, numero: result.numero })
}
