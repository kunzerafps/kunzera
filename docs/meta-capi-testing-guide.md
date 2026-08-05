# Guía de validación manual — Meta Events Manager

Esta guía es el paso que el código NO puede hacer solo. Después de subir estos
cambios (branch/preview, todavía no producción), hay que verificar en
[Events Manager](https://business.facebook.com/events_manager2) → Pixel
`761377043609509` → **Test Events** que cada caso se comporte como se
documenta acá.

## Antes de empezar

1. En Events Manager → Test Events, copiar el `test_event_code` (algo como `TEST12345`).
2. **Temporal, solo para probar**: en cada request de prueba a los endpoints de abajo, si querés verlos aparecer inmediatamente en la pestaña "Test Events" (en vez de esperar a la pestaña normal de eventos, que tarda), se puede pasar `test_event_code` en el payload — hoy el código NO lo manda (a propósito, para no dejarlo pegado en producción por error). Si se quiere usar, agregarlo manualmente y temporalmente en `metaCapi.ts` (`test_event_code: params.testEventCode`) y sacarlo antes de mergear. **No dejar un test_event_code hardcodeado en el código que se sube a producción.**
3. Sin ese paso, los eventos igual llegan — solo que aparecen en la pestaña normal de "Overview"/diagnóstico, con más demora (minutos, no segundos).

## Caso 1 — Compra aprobada de Mercado Pago
- **Cómo generarlo**: hacer una reserva de prueba pagando con Mercado Pago (sandbox o real de bajo monto) hasta que el pago quede `approved`.
- **Evento esperado**: `Purchase`, 1 solo.
- **Evento que NO debería aparecer**: ningún otro `Purchase` para el mismo `event_id`.
- **event_id**: el `idempotencyKey` de esa reserva (visible en el panel admin o en los logs de la función `mp-webhook`).
- **value / currency**: precio BASE del pack (Platino $50.000 / Diamante $70.000), `ARS` — no el total con la comisión de MP.
- **origen (action_source)**: `website`, con `event_source_url` = `https://kunzera.com/`.
- **Deduplicación esperada**: no aplica acá — es el único evento que se manda para esta venta (no hay píxel de navegador en paralelo).
- **Estado esperado en Events Manager**: "Recibido", Event Match Quality con teléfono y nombre coincidentes (y `client_ip_address`/`client_user_agent`/`fbp`/`fbc` si la reserva se hizo con sesión de navegador real, no con curl).

## Caso 2 — Mercado Pago pendiente
- **Cómo generarlo**: iniciar un pago de MP y dejarlo en `pending` (ej. pago en efectivo/rapipago, sin acreditar).
- **Evento esperado**: ninguno.
- **Evento que NO debería aparecer**: `Purchase`.
- **Estado esperado**: nada nuevo en Test Events para ese `idempotencyKey`.

## Caso 3 — Mercado Pago rechazado
- **Cómo generarlo**: usar una tarjeta de prueba de MP que rechace el pago (ver [tarjetas de test de MP](https://www.mercadopago.com.ar/developers/es/docs/checkout-api/additional-content/your-integrations/test/cards)).
- **Evento esperado**: ninguno.
- **Igual que el caso 2**: sin `Purchase`.

## Caso 4 — Transferencia enviada, todavía no confirmada
- **Cómo generarlo**: hacer una reserva por transferencia, subir cualquier comprobante (puede ser de prueba), SIN que el admin la confirme en el panel todavía.
- **Evento esperado**: ninguno de `Purchase`. (Puede aparecer `InitiateCheckout` — ver caso 9 — eso sí es esperado.)
- **Estado esperado**: la reserva queda "pendiente" en el panel; cero eventos `Purchase` en Events Manager para ese `idempotencyKey`.

## Caso 5 — Transferencia confirmada
- **Cómo generarlo**: en el panel admin, abrir esa misma reserva del caso 4 y apretar "Confirmar pago".
- **Evento esperado**: `Purchase`, 1 solo.
- **event_id**: el mismo `idempotencyKey` del caso 4.
- **event_time**: OJO acá — no va a ser la hora en que apretaste "Confirmar pago", sino la hora en que se CREÓ la reserva (cuando se subió el comprobante). Si tardaste más de 7 días en confirmar, va a caer en la hora actual en su lugar (revisar los logs de la función si la fecha no coincide con lo esperado).
- **value / currency**: el monto real de la reserva (transferencia no tiene comisión que sumar), `ARS`.
- **origen**: `website`.

## Caso 6 — Binance pendiente / confirmado
- Idéntico a los casos 4 y 5, solo cambiando el método de pago a Binance en el checkout. El código no distingue transferencia de Binance en el envío a Meta (ambos pasan por el mismo endpoint `capi-confirmar-pago`) — confirmar que el `content_name` (Platino/Diamante) sea correcto.

## Caso 7 — Doble click / doble confirmación
- **Cómo generarlo**: en el panel admin, hacer doble click rápido en "Confirmar pago" de una reserva de transferencia/Binance (o llamar al endpoint dos veces seguidas a mano con el mismo `idempotencyKey`).
- **Evento esperado**: `Purchase`, 1 solo — el sistema tiene una capa de idempotencia local (antes de llegar a Meta) que frena el segundo intento.
- **Cómo verificarlo desde el código**: revisar el log de entregas (`GET /api/capi-delivery-log?token=...` desde una sesión admin) — la entrada de ese `event_id` debe mostrar `attempts: 2` pero solo 1 llamada real registrada como enviada.

## Caso 8 — Reintento de webhook (Mercado Pago)
- **Cómo generarlo**: Mercado Pago reintenta notificaciones automáticamente si no le devolvés 200 rápido, o se puede simular reenviando la misma notificación manualmente desde el panel de desarrolladores de MP.
- **Evento esperado**: `Purchase`, 1 solo, aunque la notificación haya llegado varias veces.
- **Deduplicación esperada**: no depende de Meta acá — el propio webhook frena el reprocesamiento completo (`alreadyProcessed`), antes incluso de intentar mandar nada a Meta.

## Caso 9 — InitiateCheckout
- **Cómo generarlo**: entrar al checkout del sitio (llegar a la pantalla de elegir método de pago), sin completar ningún pago.
- **Evento esperado**: `InitiateCheckout` (del navegador, vía píxel).
- **Evento que NO debería aparecer**: `Purchase`.
- **Origen**: navegador (píxel), no server-side.

## Caso 10 — Venta manual (WhatsApp, sin reserva en el sitio)
- **Cómo generarlo**: desde el panel admin, botón "Venta manual" → cargar nombre/WhatsApp/monto/fecha de hoy.
- **Evento esperado**: `Purchase`, 1 solo.
- **origen (action_source)**: `business_messaging` (no `website` — no vino del sitio).
- **event_id**: hash determinístico de teléfono+monto+día (no un UUID) — dos cargas iguales el mismo día deben dar el MISMO event_id y por lo tanto Meta los debe fusionar en 1 solo evento si se llegara a cargar dos veces por error.
- **Validar también**: cargar una fecha de más de 7 días atrás o una fecha futura — el panel debe rechazarlo ANTES de llegar a Meta (mensaje de error visible, no un error silencioso).

## Qué mirar en cada evento dentro de Events Manager

Para cualquiera de los casos de arriba, al abrir el evento en Test Events / diagnóstico:
- **Event Match Quality**: debería subir respecto a antes de este cambio — ahora incluye `fbp`/`fbc` (si el comprador vino de un anuncio o ya tenía el píxel en el navegador) e IP/user-agent reales.
- **Deduplication**: como ya no hay evento de navegador en paralelo para Purchase, Events Manager no debería mostrar "Duplicado" para ninguno de estos — si aparece, es señal de un bug (dos entregas del mismo `event_id`, revisar `capi-delivery-log`).
- **Server/Browser**: Purchase debería aparecer siempre como "Server" en la columna de origen. `InitiateCheckout` como "Browser".

## Limitación importante de Meta a tener en cuenta

La API de Conversiones **no tiene forma de "borrar" o "retractar" un evento ya mandado**. Si una venta confirmada se cancela o se reembolsa después, no hay ningún endpoint que le avise a Meta "esa compra no valió" — el evento ya contado en las métricas de la campaña se queda ahí. Lo único que el sistema puede (y debe) hacer es no perder el registro interno de que se canceló (ver "Cancelar venta" en el panel admin), para poder calcular facturación/CPA/ROAS *reales* por fuera de lo que Meta reporta — que va a seguir mostrando la venta original como si nunca se hubiera anulado.
