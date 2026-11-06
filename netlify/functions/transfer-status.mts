import type { Config } from "@netlify/functions"
import { getStore } from "@netlify/blobs"
import { verifySessionToken } from "./lib/adminSession"

// Lectura para los carteles del panel: qué concluyó transfer-check de cada
// reserva. Solo claves internas y resultados, sin datos de clientes.
export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET") {
    return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 })
  }
  const token = new URL(req.url).searchParams.get("token")
  if (!verifySessionToken(token)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 })
  }

  const state = (await getStore("transfer-check").get("state", { type: "json" })) as {
    verdicts?: Record<string, { result: string }>
    repeats?: Record<string, number>
  } | null

  const verdicts: Record<string, string> = {}
  for (const [key, v] of Object.entries(state?.verdicts ?? {})) verdicts[key] = v.result
  return Response.json(
    { ok: true, verdicts, repeats: Object.keys(state?.repeats ?? {}) },
    { headers: { "Cache-Control": "no-store" } },
  )
}

export const config: Config = {
  path: "/api/transfer-status",
}
