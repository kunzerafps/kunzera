# CLAUDE.md — kunzera.com

Guía para Claude Code al trabajar en este repo. **Se carga sola en cada sesión que se abra en esta carpeta** — lo de acá no depende de que nadie se acuerde de nada.

## Qué es

Sitio de reservas de Kunzera (servicio de optimización de PCs, dueño: Eze). React 18 + Vite + Netlify Functions (`.mts`) + Netlify Blobs. Dos packs: **PLATINO $50.000** y **DIAMANTE $70.000**.

**`main` deploya a producción automáticamente por Netlify.** Un `git push origin main` sale al aire. Commitear y pushear **solo cuando Eze lo pide**.

## ⚠️ Trampas que rompen cosas de verdad

### 1. El campo `email` del Apps Script es un HONEYPOT anti-spam

`google-apps-script/Code.gs:108` → `if (body.email) return { ok: false, error: 'spam_detected' }`

El `email` del payload que `src/lib/appsScript.ts` le manda al Sheet **NO es el mail del cliente**: es una trampa para bots. Mandarle un mail real ahí hace que **TODAS las reservas del sitio sean rechazadas**.

El mail del cliente viaja por otro camino: `capture-attribution` → blob `attribution-data` → `capi-confirmar-pago` lo lee y lo suma al evento de Compra de Meta. Protegido por `src/lib/appsScriptHoneypot.test.ts` — **no borrar ese test**.

### 2. El Apps Script es READ-ONLY

`google-apps-script/Code.gs` vive en Google, fuera de este repo. Eze lo rompió una vez y le tiene miedo. **Nunca proponer editarlo.** Si algo necesita un cambio ahí, buscar la solución de este lado.

### 3. Todo `fetch` de tracking cerca de una navegación necesita `keepalive: true`

Sin eso el navegador mata el pedido cuando la página se descarga. Fue la causa raíz de dos agujeros grandes: el guardado del rastro del anuncio (la persona toca "Pagar con Mercado Pago" y se va) y el PageView server-side (arranca a los 400ms y el tráfico de anuncios rebota antes). Ver `src/lib/attributionCapture.ts`, `src/hooks/useServerPageView.ts` y `src/lib/pixel.ts` (el POST a `/api/capi-funnel`, que era la última excepción y se cerró en la ronda 4).

### 4. No reconstruir el chequeo diario

Existió `netlify/functions/daily-gap-report.mts` y **está borrado a propósito** (commit `1103c04`). Comparaba ventas reales contra el conteo *atribuido* de Meta — comparación inválida que daba falsa alarma casi todos los días. Eze lo rechazó explícitamente. **No proponer reconciliador / cola / heartbeat sin que él lo pida.**

## Verificación obligatoria

Los tres tienen que quedar en verde, siempre, antes de commitear:

```
npx tsc -b
npx vitest run
npx vite build
```

Tests en `netlify/functions/test/` y `src/lib/*.test.ts`. Entorno `node`, sin DOM: los tests de cliente stubean `window` / `localStorage` / `sessionStorage` a mano.

**Gotchas de tests:**
- `toISOString().slice(0,10)` da la fecha en **UTC**, y `capi-venta-manual` compara contra "hoy en Argentina" (UTC-3) → después de las 21hs argentinas rechaza con `fecha_futura`. Usar el día anterior.
- Los endpoints validan `eventId` con `/^[a-zA-Z0-9-]{6,80}$/` — mínimo 6 caracteres.

## Invariantes del tracking hacia Meta (no romper)

- **`Purchase` es 100% server-side.** Nunca desde el navegador. Se marca como enviado **solo después** del 200 de Meta. Dedup propio en el blob `capi-events-sent` (lectura fuerte) + el dedup de Meta (48hs). **Este patrón está bien resuelto — no tocarlo.**
- **El `value` nunca se toma del cliente.** `capi-funnel.mts` es un endpoint público sin contraseña: el monto lo resuelve el servidor desde el pack contra `lib/packPrices.ts`.
- **`Schedule` y `Purchase` no salen por el endpoint público.** Solo server-side, con la venta ya confirmada.
- **Sesión del equipo:** `isStaffSession()` (`src/lib/pixel.ts` + copia inline en `index.html`) corta TODOS los eventos de Meta cuando Eze está en el panel. Escotilla: `?kz_track=1`.
- **`fbp`/`fbc` nunca se inventan** — solo se mandan si existían de verdad en el navegador.
- Versión de la Graph API y Pixel ID: `netlify/functions/lib/metaPixelId.ts`, un solo lugar.

## Métodos de pago vigentes

**Transferencia al alias + Mercado Pago.** Binance se dio de baja (Eze: *"JAMÁS vendo por Binance"*, commit `d4f6dd9`) — se sacó de `METHODS` en `PaymentStep.tsx` y de los textos, pero la maquinaria de atrás quedó intacta por las reservas viejas etiquetadas así. Para reactivarlo: devolver una línea al array `METHODS`.

Mercado Pago cobra **+7,77%** (`mpTotal` en `src/lib/pricing.ts`). A Meta se le informa el precio **base**, a AFIP el **total** — decisión deliberada, documentada en `mp-webhook.mts`.

## Cómo trabaja Eze

- **Explicaciones en criollo, sin tecnicismos**, sobre todo en temas de Meta / pixel / anuncios. Es técnico en su código pero no en marketing.
- **Los trade-offs de negocio los decide él**, no Claude. Si un cambio le mueve números que él mira (ROAS, facturación, precios), preguntar antes.
- **Calibrar la severidad de los riesgos.** No dramatizar para que actúe: mecanismo concreto, qué NO puede pasar, y probabilidad real.
- **Marca "atendido" cuando se sienta a hacer el trabajo**, no cuando entra el pago (puede ser 48hs después de la reserva). Ese click es lo que dispara el aviso de Compra a Meta en transferencia.
