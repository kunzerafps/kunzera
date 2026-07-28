import type { Context } from "@netlify/functions"
import { getStore } from "@netlify/blobs"
import { PACKS } from "../../src/lib/packs"
import { mpTotal } from "../../src/lib/pricing"

const SITE_CONFIG_STORE = "site-config"
const SITE_CONFIG_KEY = "site-config"

type Pack = "platino" | "diamante"

// Este endpoint solo lo llama el propio front, siempre same-origin (fetch a
// "/api/..."), así que no necesita headers CORS permisivos — evita que
// cualquier sitio externo pueda scriptear la creación de preferencias contra
// la cuenta de Mercado Pago de Kunzera.
function baseHeaders(): HeadersInit {
  return { "Cache-Control": "no-store" }
}

// Los precios se pueden editar desde el panel admin (ver wa-messages.mts),
// así que leemos el mismo store antes de usar el precio fijo de packs.ts.
async function getBasePriceArs(pack: Pack): Promise<number> {
  try {
    const store = getStore(SITE_CONFIG_STORE)
    const data = (await store.get(SITE_CONFIG_KEY, { type: "json" })) as
      | { prices?: Record<Pack, { ars?: number }> }
      | null
    const override = data?.prices?.[pack]?.ars
    if (typeof override === "number" && override > 0) return override
  } catch {
    // si falla Blobs, seguimos con el precio fijo
  }
  return PACKS[pack].price
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  const headers = baseHeaders()

  if (req.method !== "POST") {
    return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405, headers })
  }

  const accessToken = process.env.MP_ACCESS_TOKEN
  if (!accessToken) {
    return Response.json({ ok: false, error: "mp_not_configured" }, { status: 500, headers })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400, headers })
  }

  const { pack, nombre, whatsapp, discord, turno, idempotencyKey } = (body ?? {}) as {
    pack?: unknown
    nombre?: unknown
    whatsapp?: unknown
    discord?: unknown
    turno?: unknown
    idempotencyKey?: unknown
  }

  if (pack !== "platino" && pack !== "diamante") {
    return Response.json({ ok: false, error: "invalid_pack" }, { status: 400, headers })
  }
  if (typeof idempotencyKey !== "string" || idempotencyKey.length < 6) {
    return Response.json({ ok: false, error: "invalid_idempotency_key" }, { status: 400, headers })
  }
  if (typeof nombre !== "string" || !nombre) {
    return Response.json({ ok: false, error: "missing_nombre" }, { status: 400, headers })
  }
  if (typeof whatsapp !== "string" || !whatsapp) {
    return Response.json({ ok: false, error: "missing_whatsapp" }, { status: 400, headers })
  }
  if (typeof turno !== "string" || !turno) {
    return Response.json({ ok: false, error: "missing_turno" }, { status: 400, headers })
  }

  const ars = await getBasePriceArs(pack)
  const total = mpTotal(ars)
  const origin = new URL(req.url).origin

  // La reserva recién se crea en la planilla (y recién ahí se avisa a
  // Discord) cuando el webhook confirma que el pago se acreditó — igual que
  // transferencia, que tampoco reserva nada hasta que se sube el
  // comprobante. Mandamos los datos como metadata de la preferencia para
  // poder reconstruir la reserva en ese momento, sin haber creado nada antes.
  const preference = {
    items: [
      {
        title: `Kunzera - Optimización PC (Pack ${PACKS[pack].name})`,
        quantity: 1,
        unit_price: total,
        currency_id: "ARS",
      },
    ],
    payer: { name: nombre },
    metadata: {
      nombre,
      whatsapp,
      discord: typeof discord === "string" && discord ? discord : "-",
      plan: pack,
      turno,
      monto: ars,
    },
    external_reference: idempotencyKey,
    back_urls: {
      success: `${origin}/?mp=success&ref=${encodeURIComponent(idempotencyKey)}`,
      pending: `${origin}/?mp=pending&ref=${encodeURIComponent(idempotencyKey)}`,
      failure: `${origin}/?mp=failure&ref=${encodeURIComponent(idempotencyKey)}`,
    },
    auto_return: "approved",
    notification_url: `${origin}/api/mp-webhook`,
    statement_descriptor: "KUNZERA",
    payment_methods: {
      excluded_payment_types: [{ id: "ticket" }],
    },
  }

  const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(preference),
  })

  if (!mpRes.ok) {
    const errText = await mpRes.text().catch(() => "")
    console.error("[mp-create-preference] error de Mercado Pago:", mpRes.status, errText)
    return Response.json({ ok: false, error: "mp_api_error" }, { status: 502, headers })
  }

  const data = await mpRes.json()
  return Response.json({ ok: true, init_point: data.init_point, total }, { headers })
}

export const config = {
  path: "/api/mp-create-preference",
}
