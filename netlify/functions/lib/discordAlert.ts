import { getStore } from "@netlify/blobs"

const ALERTED_STORE = "mp-webhook-alerted"

// Evita mandar el mismo aviso más de una vez para la misma clave. Nació en
// mp-webhook.mts (los reintentos de notificación de Mercado Pago mandarían
// un mensaje nuevo por cada reintento sin este freno) y ahora lo comparten
// también los endpoints de CAPI que no son de Mercado Pago.
async function alreadyAlerted(alertKey: string): Promise<boolean> {
  try {
    const store = getStore(ALERTED_STORE)
    return (await store.get(alertKey, { consistency: "strong" })) !== null
  } catch {
    return false
  }
}

async function markAlerted(alertKey: string): Promise<void> {
  try {
    const store = getStore(ALERTED_STORE)
    await store.set(alertKey, "1")
  } catch (err) {
    console.error("[discordAlert] no se pudo marcar la alerta como enviada:", err)
  }
}

// Manda un mensaje de texto libre al Discord de avisos (MP_DISCORD_WEBHOOK_URL),
// con freno anti-spam por clave — la clave decide qué se considera "el mismo
// problema". Si no está configurado el webhook, no manda nada.
export async function notifyDiscord(alertKey: string, content: string): Promise<void> {
  const webhookUrl = process.env.MP_DISCORD_WEBHOOK_URL
  if (!webhookUrl) return
  if (await alreadyAlerted(alertKey)) return

  // Timeout corto y explícito: esto se llama casi siempre DESPUÉS de que ya
  // falló otra llamada externa (Meta CAPI, con su propio timeout de 8s) —
  // sin límite acá, la suma de ambas podría superar el límite real de
  // ejecución de Netlify (~10s) y cortar la función antes de terminar,
  // dejando la alerta a medio mandar.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // allowed_mentions vacío: el contenido puede incluir datos que
      // controla el cliente (nombre, etc.) — sin esto, un "@everyone" ahí
      // pingearía a todo el servidor de Discord.
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      signal: controller.signal,
    })
    await markAlerted(alertKey)
  } catch (err) {
    console.error("[discordAlert] no se pudo avisar el problema a Discord:", err)
  } finally {
    clearTimeout(timer)
  }
}
