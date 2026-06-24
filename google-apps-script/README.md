# Kunzera — Apps Script backend

Este código es el "backend" serverless que permite al chatbot escribir reservas en Google Sheets y subir comprobantes a Google Drive, sin exponer credenciales en el frontend.

## Deploy paso a paso

1. Ir a https://script.google.com y crear un **New Project** llamado `Kunzera Backend`.
2. Pegar el contenido de `Code.gs` en el editor (reemplazar el `Code.gs` por defecto).
3. En la parte superior del editor, abrir el panel **Project Settings** (ícono de engranaje) → activar **"Show appsscript.json manifest file"**.
4. Volver al editor, abrir `appsscript.json` y pegar el contenido de nuestro `appsscript.json`.
5. **Script Properties**: en `Project Settings → Script Properties → Add script property`, agregar:
   - `ADMIN_TOKEN` = token aleatorio largo (ej: usar `crypto.randomUUID()`). Este token se copia luego a `src/lib/constants.ts` en el front.
   - `DISCORD_WEBHOOK_URL` = URL del webhook de Discord (opcional, si no lo ponés simplemente no se notifica).
6. Autorizar los scopes corriendo `submitOrder` una vez manualmente (aparecerá popup de permisos). Aceptar todos.
7. **Deploy**:
   - `Deploy → New deployment`
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**, copiar la URL que termina en `/exec`.
8. Pegar esa URL en `src/lib/constants.ts` como `APPS_SCRIPT_URL`.

## Cómo crear el Discord webhook (opcional)

En un servidor de Discord propio:
1. `Server Settings → Integrations → Webhooks → New Webhook`
2. Elegir canal, copiar **Webhook URL**
3. Pegar en Script Property `DISCORD_WEBHOOK_URL`

## Redeploys

**Importante:** cada cambio en `Code.gs` requiere crear una nueva versión del deployment para que tome efecto. Para mantener la misma URL:

1. `Deploy → Manage deployments`
2. Click ✏️ sobre el deployment actual
3. Version: **New version**
4. Click **Deploy**

Si creás un *New deployment* en lugar de editar, te da una URL distinta y tenés que actualizar el front.

## Endpoints

### `POST /exec` — reservar turno

```json
{
  "action": "submitOrder",
  "nombre": "Juan Pérez",
  "whatsapp": "+5493382677871",
  "discord": "juan#1234",
  "plan": "platino",
  "monto": 35000,
  "turno": "2026-04-17T19:05:00-03:00",
  "idempotencyKey": "uuid-v4",
  "file": {
    "base64": "iVBORw0KGgo...",
    "mime": "image/png"
  }
}
```

Respuesta:

```json
{ "ok": true, "fileUrl": "https://drive.google.com/...", "timestamp": "2026-04-17 18:52:14" }
```

Errores posibles: `missing_field`, `slot_taken`, `spam_detected`.

### `GET /exec?action=getTakenSlots`

Respuesta:
```json
{ "ok": true, "slots": ["2026-04-17T19:05:00-03:00", ...] }
```

### `GET /exec?action=getOrders&token=XXXX`

Respuesta:
```json
{ "ok": true, "orders": [{ "timestamp": "...", "nombre": "...", "plan": "platino", ... }] }
```

## CORS

Apps Script Web App responde `Access-Control-Allow-Origin: *` automáticamente, **pero** solo si no se dispara preflight OPTIONS. Por eso el cliente manda `Content-Type: text/plain;charset=utf-8` y Apps Script parsea el body con `JSON.parse(e.postData.contents)`.

## Seguridad

- **Sheet y Drive folder** se escriben con los permisos del dueño del script (`executeAs: USER_DEPLOYING`), no del visitante. El Sheet no necesita ser público.
- **`ADMIN_TOKEN`** protege el endpoint `getOrders`. Debe mantenerse en sincronía con `src/lib/constants.ts`.
- **Honeypot:** el endpoint rechaza requests que traen un campo `email` (los bots lo llenan; humanos no, porque el campo está oculto en el frontend).

## Límites conocidos

- 20.000 ejecuciones/día (quota gratuita)
- 50 MB por request
- 6 min de timeout por ejecución
- 100 emails/día (si se activa `MailApp`)
