import { APPS_SCRIPT_URL, ADMIN_SECRET_TOKEN } from "./constants"
import type { Order, OrderDraft } from "../types/order"
import { normalizeIso } from "./slots"

type ApiResult<T> = { ok: true } & T | { ok: false; error: string; field?: string }

export type SubmitPayload = {
  nombre: string
  whatsapp: string
  discord: string
  plan: string
  monto: number
  turno: string
  idempotencyKey: string
  file?: { base64: string; mime: string }
  email?: string // honeypot
}

async function postJson<T>(payload: unknown, timeoutMs = 45000): Promise<ApiResult<T>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      // text/plain evita el preflight OPTIONS. Apps Script lee e.postData.contents igual.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: "follow",
    })
    if (!res.ok) return { ok: false, error: `http_${res.status}` }
    const data = await res.json()
    return data as ApiResult<T>
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg.includes("abort") ? "timeout" : "network" }
  } finally {
    clearTimeout(timer)
  }
}

async function getJson<T>(url: string, timeoutMs = 15000): Promise<ApiResult<T>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" })
    if (!res.ok) return { ok: false, error: `http_${res.status}` }
    const data = await res.json()
    return data as ApiResult<T>
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg.includes("abort") ? "timeout" : "network" }
  } finally {
    clearTimeout(timer)
  }
}

export async function submitOrder(
  draft: OrderDraft,
  idempotencyKey: string,
): Promise<ApiResult<{ fileUrl: string; timestamp: string }>> {
  if (!draft.nombre || !draft.whatsapp || !draft.discord || !draft.pack || !draft.turno) {
    return { ok: false, error: "missing_fields" }
  }

  const payload: SubmitPayload = {
    nombre: draft.nombre,
    whatsapp: draft.whatsapp,
    discord: draft.discord,
    plan: draft.pack,
    monto: draft.monto || 0,
    turno: normalizeIso(draft.turno),
    idempotencyKey,
  }
  if (draft.file) {
    payload.file = { base64: draft.file.base64, mime: draft.file.mime }
  }

  // Retry x3 con backoff exponencial + jitter
  let lastErr = "unknown"
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      const delay = 500 * Math.pow(2, attempt) + Math.random() * 300
      await new Promise((r) => setTimeout(r, delay))
    }
    const result = await postJson<{ fileUrl: string; timestamp: string }>(payload)
    if (result.ok) return result
    lastErr = result.error
    // No retry si el error es lógico (slot tomado, validación, etc.)
    if (["slot_taken", "missing_field", "spam_detected"].includes(lastErr)) {
      return result
    }
  }
  return { ok: false, error: lastErr }
}

export async function getTakenSlots(): Promise<string[]> {
  const url = `${APPS_SCRIPT_URL}?action=getTakenSlots`
  // Mismo bug de CORS intermitente que getOrders: reintentamos.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400))
    const result = await getJson<{ slots: string[] }>(url)
    if (result.ok) return (result.slots || []).map(normalizeIso)
  }
  return []
}

export async function getOrders(): Promise<Order[]> {
  const url = `${APPS_SCRIPT_URL}?action=getOrders&token=${encodeURIComponent(ADMIN_SECRET_TOKEN)}`
  // Apps Script tiene un bug conocido: el redirect 302 a googleusercontent
  // a veces NO trae el header CORS y el navegador bloquea la respuesta.
  // El fallo es instantáneo, así que reintentamos varias veces: cada intento
  // genera un request nuevo con otra chance de pasar. Timeout amplio cubre el
  // "cold start" (15-30s) del primer intento.
  let lastErr = "unknown"
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 400))
    const result = await getJson<{ orders: Order[] }>(url, 30000)
    if (result.ok) return result.orders || []
    lastErr = result.error
  }
  console.error("[getOrders] falló tras 4 intentos:", lastErr)
  return []
}

export async function updateOrderStatus(
  idempotencyKey: string,
  estado: string,
): Promise<ApiResult<{ row: number; estado: string }>> {
  if (!idempotencyKey) return { ok: false, error: "missing_idempotency_key" }
  return postJson<{ row: number; estado: string }>({
    action: "updateStatus",
    token: ADMIN_SECRET_TOKEN,
    idempotencyKey,
    estado,
  })
}

export async function deleteOrder(
  idempotencyKey: string,
): Promise<ApiResult<{ deleted: number }>> {
  if (!idempotencyKey) return { ok: false, error: "missing_idempotency_key" }
  return postJson<{ deleted: number }>({
    action: "deleteOrder",
    token: ADMIN_SECRET_TOKEN,
    idempotencyKey,
  })
}

export async function ping(): Promise<boolean> {
  const url = `${APPS_SCRIPT_URL}?action=ping`
  const result = await getJson<{ ts: number }>(url, 3000)
  return result.ok
}
