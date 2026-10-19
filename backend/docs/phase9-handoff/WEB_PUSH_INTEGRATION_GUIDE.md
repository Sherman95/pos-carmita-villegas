# Guía de Integración de Web Push (Fase 9) — sobre la Fase 8 real

> Regla de lectura: **[VERIFICADO]** = existe hoy en el repo; **[RECOMENDADO]** = propuesta para Fase 9,
> no implementada. Nada de este documento se ha ejecutado: la Fase 9 no está iniciada.

## 1. Objetivo y alcance

**[VERIFICADO]** Fase 8 entrega notificaciones internas persistidas en `notifications` y una bandeja con
polling de 30 s (POS y SIDRO). No hay push, ni email de notificaciones, ni WhatsApp automático.
**[RECOMENDADO]** Fase 9 = entregar esas mismas notificaciones como **Web Push del navegador** a los
dispositivos suscritos, sin cambiar el modelo de negocio ni duplicar eventos. La bandeja interna sigue
siendo la fuente de verdad; el push es un canal adicional de entrega.

## 2. Punto de integración único (el “choke point”)

**[VERIFICADO]** Todos los avisos pasan por `NotificationsService.insertForRecipient(client, recipientType, recipientId, input)`
(`src/services/notifications.service.ts:17-39`), invocado por `notifyPosStaff`, `notifyAssignedProfessional`
y `notifySidroAccount` desde 10 puntos ya mapeados (`NOTIFICATION_EVENTS_MATRIX.md`).
**[RECOMENDADO]** Enganchar el push **en ese único lugar** o inmediatamente después del mismo: cualquier
diseño que toque los 10 call-sites por separado duplica lógica y garantiza divergencias. Lo natural:
`insertForRecipient` sigue haciendo su INSERT (bandeja) y, además, encola una entrega en outbox
(decisión sobre transacción en el punto 9).

## 3. Tabla de suscripciones (esquema recomendado, aditivo e idempotente)

**[RECOMENDADO]** Nueva migración idempotente (patrón Fase 8: SQL de referencia + `init…()` en arranque):

```sql
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  subscriber_type VARCHAR(16) NOT NULL CHECK (subscriber_type IN ('pos_user','sidro_account')),
  subscriber_id TEXT NOT NULL,                -- users.id o sidro_client_accounts.id
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint)
);
CREATE INDEX IF NOT EXISTS push_subscriptions_subscriber_idx
  ON push_subscriptions (subscriber_type, subscriber_id) WHERE disabled_at IS NULL;
```

Notas: `UNIQUE(endpoint)` permite UPSERT al re-suscribir el mismo navegador; `disabled_at` en lugar de
DELETE para auditoría y para tolerar fallos transitorios. Igual que `notifications`, sin FK a
`subscriber_id` (es polimórfico) o con FK opcional separada por tipo — a decidir en implementación.

## 4. Endpoints sugeridos

**[RECOMENDADO]** Añadir a las rutas existentes (sin tocar las 4 de bandeja):

- POS (tras `verifyToken, requireStaff`): `POST /api/notifications/subscriptions` (body: `PushSubscription.toJSON()`), `DELETE /api/notifications/subscriptions` (body: `{endpoint}`).
- SIDRO (tras `verifyToken, requireSidroClient`): `POST /api/sidro/notifications/subscriptions`, `DELETE /api/sidro/notifications/subscriptions`.
- `subscriber_type/subscriber_id` **siempre** derivados de `req.authIdentity`/`req.userId` (nunca del body), igual que `recipientTypeFor` en la bandeja (`notifications.controller.ts:5-6`).
- Opcional: `GET /api/notifications/vapid-public-key` (o inyectar la clave pública por `environment` en cada frontend, preferible).

## 5. Dedupe de push

**[VERIFICADO]** La bandeja deduplica por `(recipient_type, recipient_id, dedupe_key)` con `ON CONFLICT DO NOTHING`.
**[RECOMENDADO]** Reutilizar el mismo `dedupe_key` como clave de la cola de push: si el INSERT de la
bandeja fue no-op (evento repetido), no encolar push. Implementación simple: `INSERT INTO notifications …
ON CONFLICT DO NOTHING RETURNING id` y solo si `id` volvió, encolar; o cola con el mismo `UNIQUE`
(`delivery_dedupe_key = recipient_type|recipient_id|dedupe_key|endpoint`).

## 6. Multi-dispositivo

**[RECOMENDADO]** Una fila por `(subscriber, endpoint)` ⇒ un mismo usuario puede tener POS en desktop,
SIDRO en móvil, etc. El fan-out de un evento = 1 entrega por suscripción activa. Al suscribir el mismo
`endpoint` otra vez: UPSERT que actualiza `p256dh/auth/last_seen_at` (las claves rotan).

## 7. Revocación y limpieza

**[RECOMENDADO]** En cada envío: `404/410` del push service ⇒ `disabled_at = NOW()` (o DELETE).
En logout, enviar `DELETE .../subscriptions` con el `endpoint` actual antes de borrar tokens.
En cambio de contraseña/revocación de sesiones (`token_version`), **no** invalidar push necesariamente:
la suscripción es del dispositivo, no de la sesión; decidir producto. Purga periódica de
`disabled_at IS NOT NULL` antiguas (> 90 días).

## 8. Aislamiento POS/SIDRO

**[VERIFICADO]** JWT separados por audiencia; bandeja separada por `recipient_type`.
**[RECOMENDADO]** Mantenerlo en push: payloads sin datos cruzados; un endpoint POS jamás recibe
payload de `sidro_account` ni viceversa (fan-out estrictamente por `subscriber_type` merit del evento).
Los `data.url` ya son internos de cada app (`/citas/...` vs `/my-requests/...`).

## 9. Fallos de push NO deben bloquear citas

**[VERIFICADO]** Hoy, si el INSERT de la bandeja falla, el evento entero hace ROLLBACK (garantía deseada).
Para push eso es inaceptable (proveedor externo). **[RECOMENDADO]** Outbox transaccional:
1. La transacción del evento inserta bandeja + `push_outbox` (estado `PENDING`) con el mismo `client`.
2. Tras `COMMIT`, un worker (patrón ya existente: `googleCalendarWorkerPhase5` con `SKIP LOCKED`,
   backoff y recuperación de atascados) envía pushes y marca `SENT/FAILED/SUPERSEDED`.
3. Si el envío falla, la cita/solicitud ya está confirmada y la bandeja visible: el push se reintenta.
Así el push hereda la semántica “best effort” sin tocar la invariante de Fase 8 (el INSERT de bandeja
sigue dentro de la transacción; el push no).

## 10. Estado PWA (condición de partida)

**[VERIFICADO] SIDRO** = PWA completa: `@angular/service-worker` ^18.2.0, `ngsw-config.json`,
`public/manifest.webmanifest`, registro `registerImmediately` en `app.config.ts` (solo producción,
`enabled: !isDevMode()`), auto-update vía `SwUpdate` en `app.component.ts`, ruta `/ngsw-worker.js` en
`vercel.json`. Falta solo el lado `SwPush` + VAPID.
**[VERIFICADO] POS** = **sin PWA**: sin `@angular/service-worker`, sin `ngsw-config.json`, sin manifest,
sin registro de SW. Opciones [RECOMENDADO]: (a) añadir `@angular/service-worker` a POS (misma mecánica
que SIDRO: más trabajo, cambia el deploy del POS), o (b) Firebase Cloud Messaging (FCM) con su SW
propio (no requiere PWA completa), o (c) dejar POS fuera del alcance inicial de Fase 9 (push solo a
clientas SIDRO, que son quienes más se benefician). Recomendación: **empezar por SIDRO** y decidir POS
por separado.

## 11. VAPID y configuración

**[RECOMENDADO]** Claves VAPID generadas una vez para el proyecto; variables de entorno (nombres, sin valores):
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto: del negocio). La pública viaja al
frontend (environment de cada app); la privada **solo** en backend (Render/prod y `.env` local).
Nunca en el repo, nunca en logs ni en auditorías.

## 12. Service Worker y handler de push

**[VERIFICADO]** Angular `SwPush` integraría automáticamente el manejo de `push`/`notificationclick`
sobre `ngsw-worker.js` en SIDRO (no hay código custom hoy).
**[RECOMENDADO]** `notificationclick`: abrir/enfocar pestaña y navegar a `data.url` (mismo deep-link
que la bandeja: `/my-requests?open=<id>`), y `notification.tag = notifications.id` para reemplazar en
vez de apilar. Para POS con opción (b) FCM, implementar el SW equivalente. Payload push: `{title, body,
url, notificationId}` — sin PII (coherente con la tabla: hoy `title/body` derivan de nombre de clienta
y servicio; evaluar si eso es aceptable fuera del dispositivo o si conviene un payload genérico).

## 13. Sincronización con la bandeja

**[RECOMENDADO]**
- Al tocar la push: la app marca leída (`POST .../:id/read`) antes/después de navegar (mismo flujo que la campana hoy: `markAsRead` + `navigateByUrl`).
- Si el usuario ya está en la app con la notificación leída, decidir supresión (p. ej., no enviar si `read_at` no es NULL al momento del envío, o `tag` por id).
- No crear notificaciones nuevas desde el push: el push siempre referencia una fila existente (`notification_id` en el payload).

## 14. Restricciones de plataforma

**[VERIFICADO]** Producción SIDRO sirve `/ngsw-worker.js` (Vercel). Requisitos push:
HTTPS obligatorio (prod OK; localhost exento), iOS solo con PWA **instalada** (16.4+), permiso
explícito del usuario (nunca pedirlo al cargar sin contexto: pedirlo tras una acción, p. ej. tras
confirmar una reserva). Chrome/Edge/Android OK. Safari macOS 16.4+ OK con instalación.

## 15. Plan de verificación (criterios de aceptación sugeridos)

**[RECOMENDADO]**
1. Migración idempotente de `push_subscriptions` (+ `push_outbox`) probada 2 arranques seguidos.
2. Unit tests (patrón `node --test` del backend): inserción solo si el INSERT de bandeja fue efectivo; `410` desactiva; fan-out multi-dispositivo; aislamiento POS/SIDRO; outbox no rompe el rollback de Fase 8.
3. Worker: `SKIP LOCKED`, backoff, `SUPERSEDED`, recuperación de atascados (reusar patrón Fase 5).
4. Prueba manual local **sin** envío real: endpoint falso/mock o push deshabilitado por env.
5. Regresión completa verde: `node --test` con los archivos de Fase 2-8.5A (baseline 333/333 en 9 suites) + tests de Fase 9.
6. Prohibido romper: dedupe de bandeja, `ON CONFLICT`, transaccionalidad de Fase 8, deep-links `?open=`, polling actual (puede quedarse como fallback).
