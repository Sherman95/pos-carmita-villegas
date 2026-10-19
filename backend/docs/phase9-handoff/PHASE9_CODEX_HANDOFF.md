# Handoff Fase 9 — Web Push sobre Notificaciones Internas (Fase 8 + 8.5A)

> Documento de entrada para quien implemente la Fase 9 (tool: Codex u otro agente). Leer primero esto,
> después `NOTIFICATIONS_ARCHITECTURE.md`, `NOTIFICATION_EVENTS_MATRIX.md`,
> `API_AND_DATABASE_CONTRACTS.md` y `WEB_PUSH_INTEGRATION_GUIDE.md`.
> Los cuatro usan la misma convención: **[VERIFICADO]** = existe en el repo hoy; **[RECOMENDADO]** = propuesta, no implementada.

## 1. Qué se pide en Fase 9

Añadir **Web Push** (notificaciones del navegador) como canal de entrega adicional a las notificaciones
internas de la Fase 8, sin cambiar la lógica de negocio ni romper la bandeja/polling actuales.
El sistema de Fase 8 está completo, probado (suite de 32 tests + smoke local) y en uso local.

## 2. Estado actual verificado (resumen ejecutivo)

- Bandeja interna POS+SIDRO con tabla `notifications` (dedupe por `recipient_type, recipient_id, dedupe_key`);
  **todos** los INSERT pasan por `NotificationsService.insertForRecipient` dentro de la transacción del evento.
- 10 eventos ya generan notificaciones (ver matriz). 10 templates con `type`/`title`/`body`/`data.url`/`dedupe_key` fijos.
- 4 endpoints de bandeja: `GET/POST /api/notifications(/:id/read)` y `GET/POST /api/sidro/notifications(/:id/read)`.
- Frontends: campana POS (`notifications-bell`) y tarjeta SIDRO (dashboard), ambas con polling 30 s,
  deep-links `?open=<request_id>` y limpieza al cerrar sesión.
- PWA: **SIDRO sí** (ngsw + manifest + auto-update; falta SwPush), **POS no** (decisión pendiente).
- **No existe**: push, email de notificaciones, WhatsApp automático, retención/TTL de notificaciones, FK en `recipient_id`.
- Fase 8.5A (registro/vinculación SIDRO) ya aplicada en local; incluye el fix de auditoría de vinculación
  (`admin_audit_log.target_user_id = NULL` + `link_id` en metadata, misma transacción) — no lo reviertas.

## 3. Mapa de archivos clave

Backend (`D:\Documents\pos-carmita-villegas\backend`):

| Archivo | Rol |
| ------- | --- |
| `notifications_phase8.sql` | DDL de referencia (idempotente) |
| `src/database/migrateNotificationsPhase8.ts` | Migración en arranque (`initNotificationsPhase8Table`) |
| `src/services/notifications.service.ts` | **Choke point**: `insertForRecipient` + `notify*` + resolución de destinatarios |
| `src/services/notificationTemplates.ts` | 10 templates + `formatNotification*` + deep-links |
| `src/controllers/notifications.controller.ts` | `listNotifications`, `markNotificationRead`, `recipientTypeFor` |
| `src/routes/notifications.routes.ts` | Rutas POS (`verifyToken, requireStaff`) |
| `src/routes/sidro.routes.ts` (líneas 62-63) | Rutas SIDRO (`verifyToken, requireSidroClient`) |
| `src/controllers/adminSidro.controller.ts` | Genera 7 de los 10 eventos (accept/reject/propose/link/create-client + auditoría) |
| `src/controllers/sidroAppointments.controller.ts` | `createRequest`, `acceptProposal`, `rejectProposal` |
| `src/controllers/appointments.controller.ts` | `notifyCancelledSidroRequests` (update/delete de citas) |
| `src/middlewares/auth.middleware.ts` | `verifyToken`, `requireStaff`, `requireSidroClient`, audiencias JWT |
| `src/security/rbac.ts` | Matriz de permisos por rol |
| `src/index.ts` | Montaje de rutas + inits de arranque (`:96`, `:102-103`, `:137`) |
| `src/workers/googleCalendarWorkerPhase5.ts` | **Patrón a reutilizar** para el worker de push (SKIP LOCKED, backoff) |
| `tests/notifications-whatsapp.phase8.test.cjs` | 32 tests de contrato/efectos |
| `tests/notifications-whatsapp.phase8.local-smoke.cjs` | Smoke contra BD local real |

Frontends:

| Proyecto | Archivos |
| -------- | -------- |
| POS (`frontend/src/app`) | `services/notifications.service.ts`; `components/notifications-bell/*`; `components/sidro-requests/sidro-requests.component.{ts,html}` (deep-link); `components/sidenav/sidenav.html` |
| SIDRO (`SIDRO CARMITA VILLEGAS/src/app`) | `services/notifications.service.ts`; `components/dashboard/dashboard.component.ts` (+ `dashboard.reference.html`, `dashboard.notifications.scss`); `components/my-requests/my-requests.component.ts` (+ `my-requests.view.html`); `app.config.ts` (SW), `app.component.ts` (SwUpdate), `ngsw-config.json`, `public/manifest.webmanifest` |

## 4. No negociables (reglas del repo)

1. **No romper fases 1-8.5A.** Regresión completa verde antes de entregar:
   `npm run build` + `node --test tests/<archivo1> tests/<archivo2> …` (los 9 archivos de fases; baseline actual 333/333).
   Nunca `node --test tests/` (sin args) en este entorno.
2. Migraciones **aditivas e idempotentes** (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`), con SQL de
   referencia en la raíz del backend y verificación en arranque (patrón Fase 8/8.5A). Nada de borrar/renombrar.
3. Los INSERT de bandeja siguen **dentro** de la transacción del evento (Fase 8, test nº 30). El push
   se hace **post-COMMIT** vía outbox/worker (ver guía §9).
4. JWT: nunca tocar `JWT_SECRET` ni las audiencias `pos`/`sidro`; `subscriber_type`/`subscriber_id` se
   derivan del token, jamás del body.
5. Sin secretos en repo ni en docs: las claves VAPID van en `.env`/Render (`VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). Brevo (`BREVO_*`) no se toca en Fase 9.
6. Base de datos de desarrollo: solo local (`postgres://postgres:***@localhost:5432/poscarmitaVlocal`).
   Prohibido producción (Supabase/Render/Vercel) para pruebas. No enviar correos Brevo reales ni pushes
   reales en pruebas locales.
7. No commits/push/deploy salvo pedido explícito del dueño del repo.

## 5. Brevo (contexto, no parte de Fase 9)

**[VERIFICADO]** Brevo se usa **solo para correos transaccionales de cuenta SIDRO/POS**, nunca para
notificaciones internas:

| Método (`src/services/brevo.service.ts`) | Uso |
| ---------------------------------------- | --- |
| `sendEmailVerificationEmail` | Registro SIDRO / cambio de correo (`sidroAuthPhase4.controller.ts:77,297`) |
| `sendPasswordResetEmail` | Recuperación SIDRO (`:231`) |
| `sendPasswordChangedEmail` | Cambio de contraseña SIDRO (`:272`) |
| `sendEmailChangedNotice` | Aviso al correo anterior tras cambio (`:334`) |
| `sendPosPasswordResetEmail` | Reset de acceso POS por administrador (`auth.controller.ts:522`) |

Env names: `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `BREVO_PASSWORD_RESET_TEMPLATE_ID`,
`BREVO_PASSWORD_CHANGED_TEMPLATE_ID` (opcionales los template IDs; hay fallback HTML).
`BrevoService.isConfigured()` nunca lanza; los envíos no críticos se hacen con `.catch()`.
Fase 9 **no requiere Brevo**.

## 6. Plan sugerido para Codex (orden recomendado)

1. Crear migración idempotente `push_subscriptions` (+ `push_outbox` si se adopta la guía §9).
2. Añadir `PushDispatchService` (encolar tras INSERT de bandeja efectivo) y worker con patrón Fase 5.
3. Endpoints de suscripción (POS/SIDRO) derivando identidad del token.
4. SIDRO (SwPush + VAPID): permisos de UI tras acción del usuario, `notificationclick` → `data.url`, `tag`.
5. Decidir POS: añadir PWA/SW o FCM o excluir del alcance inicial (recomendado: partir por SIDRO).
6. Tests: unit del dispatch/worker + regresión completa; smoke local sin envíos reales.

## 7. Checklist de aceptación (sin implementar nada que lo rompa)

- [ ] `notifications` intacta (mismo DDL/unique/índices); ningún evento de Fase 8 cambia de `dedupe_key`, `type` ni `data.url`.
- [ ] Los 4 endpoints de bandeja responden igual que hoy (shapes y códigos).
- [ ] Fase 8 tests (32) + fase 4/6/7/8.5A verdes; regresión total ≥ 333/333.
- [ ] Fallo de push no produce 500 en endpoints de citas/solicitudes (outbox post-COMMIT).
- [ ] Aislamiento POS/SIDRO en suscripciones y payloads verificado con token cruzado (403).
- [ ] Sin secretos en código/logs; migraciones idempotentes probadas con doble arranque.
