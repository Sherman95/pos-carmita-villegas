# Arquitectura de Notificaciones Internas POS/SIDRO (Fase 8 + ajustes 8.5A)

> Documento de traspaso para la Fase 9 (Web Push). Describe **solo lo que existe y está verificado**
> en el código y en la base local, más las brechas conocidas. No propone cambios de implementación
> aquí; las recomendaciones viven en `WEB_PUSH_INTEGRATION_GUIDE.md`.
>
> Estado: Fase 8 completa; Fase 8.5A (registro/vinculación SIDRO) ya aplicada. Notificaciones = solo
> bandeja interna con polling. **No existe Web Push, ni email de notificaciones, ni WhatsApp automático.**

## 0. Resumen en una imagen

```
Evento de negocio (cita/solicitud/vinculación)
   └─ controller (transacción BEGIN…COMMIT existente)
        └─ SidroNotificationTemplates.<evento>(contexto)  → NotificationInput {type,title,body,data,dedupeKey}
             └─ NotificationsService.notifyPosStaff / notifyAssignedProfessional / notifySidroAccount
                  └─ INSERT INTO notifications … ON CONFLICT (recipient_type, recipient_id, dedupe_key) DO NOTHING
                       (misma conexión/transacción del evento; si falla, hace ROLLBACK todo el evento)
Frontend (campana POS / tarjeta SIDRO)
   └─ GET /api/notifications  o  GET /api/sidro/notifications  (polling cada 30 s)
        └─ POST …/:id/read  (marca leída; navega a data.url)
```

## A. Modelo PostgreSQL (verificado en `poscarmitaVlocal`)

DDL de referencia: `notifications_phase8.sql` (raíz del backend) y la versión embebida que se
ejecuta al arrancar el servidor en `src/database/migrateNotificationsPhase8.ts` (`initNotificationsPhase8Table()`,
llamada desde `src/index.ts:137`). Ambas son idempotentes (`CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`).

Columnas reales (`pg_catalog`, esquema `public`):

| Columna          | Tipo real          | Nulo | Default                     |
| ---------------- | ------------------ | ---- | --------------------------- |
| `id`             | `bigint` (identity) | NO   | `nextval('notifications_id_seq')` |
| `recipient_type` | `varchar(16)`       | NO   | —                           |
| `recipient_id`   | `text`              | NO   | —                           |
| `type`           | `varchar(64)`       | NO   | —                           |
| `title`          | `text`              | NO   | —                           |
| `body`           | `text`              | NO   | —                           |
| `data`           | `jsonb`             | NO   | `'{}'::jsonb`               |
| `dedupe_key`     | `text`              | NO   | —                           |
| `read_at`        | `timestamptz`       | SÍ   | —                           |
| `created_at`     | `timestamptz`       | NO   | `now()`                     |
| `expires_at`     | `timestamptz`       | SÍ   | —                           |

Restricciones reales:

- `notifications_pkey` PRIMARY KEY (`id`).
- `notifications_recipient_type_check`: `CHECK (recipient_type IN ('pos_user','sidro_account'))`.
- `notifications_recipient_dedupe_unique`: `UNIQUE (recipient_type, recipient_id, dedupe_key)`.
- NOT NULL en `recipient_type`, `recipient_id`, `type`, `title`, `body`, `data`, `dedupe_key`, `created_at`.

Índices reales:

- `notifications_recipient_created_idx` (`recipient_type, recipient_id, created_at DESC`)
- `notifications_recipient_unread_idx` (`recipient_type, recipient_id`) `WHERE read_at IS NULL`
- `notifications_recipient_dedupe_unique` (índice único del constraint)

Notas de contrato (importantes para Fase 9):

- **No hay FK** para `recipient_id`: acepta `users.id` (UUID de POS) o `sidro_client_accounts.id` (UUID SIDRO) según `recipient_type`. Un `recipient_id` huérfano no rompe inserts.
- `id` es `bigint`; en Node/`pg` llega como *string* por defecto… pero el controller lo expone tal cual y el frontend lo tipa `number`. Con `BIGSERIAL` pequeño no hay problema práctico; tenerlo presente si Fase 9 pagina por `id`.
- `type` **no tiene CHECK**: cualquier string ≤64 cabe; los values actuales están listados en `NOTIFICATION_EVENTS_MATRIX.md`.
- `expires_at` existe y `NotificationInput.expiresAt` está soportado por el servicio, **pero hoy ningún llamador lo usa** (siempre `NULL`). No hay job de limpieza/retensión: las notificaciones se acumulan indefinidamente.
- `data` guarda `{ url, request_id }` en todos los templates actuales (`url` es una ruta interna de la app correspondiente; ver matriz).
- Semántica de duplicados: `ON CONFLICT … DO NOTHING` (`src/services/notifications.service.ts:24-27`). Repetir el mismo evento para el mismo destinatario no crea fila nueva. Los `dedupe_key` incluyen el `request_id`, por lo que dos solicitudes distintas no colisionan, pero el *mismo cambio de estado* dos veces (p. ej., reintento/reenvío) no duplica.
- Verificación local: 0 grupos duplicados en `poscarmitaVlocal` (`GROUP BY recipient_type, recipient_id, dedupe_key HAVING count(*) > 1`), coherente con el constraint.

## B. Generación (único choke point: `NotificationsService`)

Archivo: `src/services/notifications.service.ts`.

- Tipo API: `NotificationRecipientType = 'pos_user' | 'sidro_account'`; `NotificationInput { type, title, body, data?, dedupeKey, expiresAt? }`.
- `insertForRecipient(client, recipientType, recipientId, input)` — INSERT con `ON CONFLICT DO NOTHING`. Ignora silenciosamente `recipientId` vacío/null (`:23`). **Recibe `PoolClient`**: siempre debe ser la conexión de la transacción en curso.
- `staffRecipientIds(client)` — `SELECT id FROM users WHERE active = true AND lower(role) = ANY(['owner','admin','reception'])` (`:41-48`). `POS_STAFF_ROLES = ['owner','admin','reception']` (`:14`).
- `assignedProfessionalRecipientIds(client, employeeId)` — usuarios `active=true`, `lower(role)='professional'` y `employee_id = $1` (`:50-61`).
- `notifyPosStaff(client, input)` — itera destinatarios staff y hace `insertForRecipient` para cada uno.
- `notifyAssignedProfessional(client, employeeId, input)` — ídem para profesionales asignados.
- `notifySidroAccount(client, accountId, input)` — un solo destinatario `sidro_account`.

Plantillas: `src/services/notificationTemplates.ts`.

- `formatNotificationDate(value)` → `DD/MM/YYYY` desde `YYYY-MM-DD…` (fallback `'fecha por confirmar'`); `formatNotificationTime(value)` → `HH:MM` (fallback `'hora por confirmar'`).
- URLs internas: `posRequestsUrl(id)` → `/citas/solicitudes?open=<id>`; `sidroRequestsUrl(id)` → `/my-requests?open=<id>` (ambas con `encodeURIComponent`).
- Cada template devuelve un `NotificationInput` completo (type/título/body/url/request_id/dedupeKey). La matriz evento→template→dedupeKey está en `NOTIFICATION_EVENTS_MATRIX.md`.

## C. Destinatarios (mapeo aplicado hoy)

| Grupo | Cómo se resuelve | `recipient_type` | `recipient_id` |
| --- | --- | --- | --- |
| Personal POS (owner/admin/reception) | `staffRecipientIds()` | `pos_user` | `users.id` |
| Profesional asignado a la solicitud | `assignedProfessionalRecipientIds(employee_id)` | `pos_user` | `users.id` |
| Clienta SIDRO | id de `sidro_client_accounts` de la solicitud/evento | `sidro_account` | `sidro_client_accounts.id` |

- La ruta de lectura decide el tipo **por identidad del token**, no por parámetro:
  `recipientTypeFor(req) = req.authIdentity === 'sidro_client' ? 'sidro_account' : 'pos_user'`
  (`src/controllers/notifications.controller.ts:5-6`).
- El `recipient_id` de lectura es siempre `req.userId` (jamás un valor del cliente): no se puede listar ni marcar como leída una notificación ajena (test 24/29 de Fase 8).
- Nota de negocio: recepción/admin/owner reciben **todas** las notificaciones operativas; el profesional solo las de **su** `employee_id`; la clienta solo lo suyo. Profesionales sin `users.employee_id` no reciben avisos por asignación.

## D. Endpoints

Véase `API_AND_DATABASE_CONTRACTS.md` (request/response completos y códigos de error). Resumen:

- POS: `GET /api/notifications`, `POST /api/notifications/:id/read` (`verifyToken + requireStaff`).
- SIDRO: `GET /api/sidro/notifications`, `POST /api/sidro/notifications/:id/read` (`verifyToken + requireSidroClient`).
- No hay endpoints de: push, contadores separados, borrado, “marcar todas”, ni reenvío.

## E. Frontends (bandeja interna)

### POS (Angular; `frontend/src/app`)

- Servicio: `services/notifications.service.ts`. `apiUrl = environment.apiBaseUrl + '/api/notifications'`; señales `items`, `unreadCount`, `lastError`; `startPolling(30000)` hace `refresh()` inmediato + `setInterval`; `stopPolling()` limpia timer y estado; `refresh()` pide `?limit=20`; `markAsRead()` hace POST y decrementa contador localmente (no re-consulta).
- UI: `components/notifications-bell/notifications-bell.{ts,html,scss}` (standalone, OnPush).
  - `ngOnInit` arranca polling solo si `auth.getToken()` existe; `ngOnDestroy` llama `stopPolling()`.
  - Badge `99+`; panel con título/cuerpo/fecha (`Intl.DateTimeFormat('es-EC')`); clic → `markAsRead` + `router.navigateByUrl(data.url)` + cierra panel.
  - Integrada en `components/sidenav/sidenav.html` (`app-notifications-bell`).
- Deep-link `?open=`: `components/sidro-requests/sidro-requests.component.ts` lee `queryParamMap.get('open')`, hace `scrollIntoView` y resalta fila (`highlighted-row` en el HTML).

### SIDRO (Angular; `SIDRO CARMITA VILLEGAS/src/app`)

- Servicio: `services/notifications.service.ts`. `apiUrl = environment.apiUrl + '/sidro/notifications'`; mismo contrato de señales/polling; `refresh()` pide `?limit=10`.
- UI embebida en el dashboard (no hay componente “campana” separado): `components/dashboard/dashboard.component.ts` (`startPolling` en `ngOnInit`, `stopPolling` en `ngOnDestroy` y en `logout()`), plantilla `dashboard.reference.html`, estilos `dashboard.notifications.scss`. Clic → `markAsRead` + `navigateByUrl(url)`.
- Deep-link `?open=`: `components/my-requests/my-requests.component.ts` (`highlightedRequestId`, `scrollIntoView` a `#sidro-request-<id>`, clase `highlighted-request` en `my-requests.view.html`).

### PWA hoy

- **SIDRO = PWA real** (instalable + caché + auto-actualización): `@angular/service-worker` ^18.2.0, `ngsw-config.json`, `public/manifest.webmanifest` (standalone, theme `#5a203f`, iconos 180/192/512), `angular.json → serviceWorker: ngsw-config.json`, `src/app/app.config.ts` registra `ngsw-worker.js` con `registrationStrategy: 'registerImmediately'` y `enabled: !isDevMode()`, `src/app/app.component.ts` escucha `VersionReadyEvent` para `activateUpdate()` + reload, `vercel.json` sirve `/ngsw-worker.js`. **Sin `SwPush`/VAPID** (no hay Web Push).
- **POS = sin PWA**: no hay `@angular/service-worker`, ni `ngsw-config.json`, ni manifest, ni registro de SW. Esto condiciona el plan de Push para POS (ver guía).

## F. Consistencia transaccional

Invariante actual (y probado): **la notificación se inserta en la misma transacción del cambio de estado**.

- `createRequest` (SIDRO): `BEGIN` → INSERT solicitud + servicios → `notifyPosStaff` + `notifyAssignedProfessional` → `COMMIT` (`sidroAppointments.controller.ts:80-149`).
- `acceptRequest` / `rejectRequest` / `proposeAlternativeRequest` (POS): `BEGIN` … `UPDATE status` → `notify…` → `COMMIT` (`adminSidro.controller.ts:661-770`, `:772-831`, `:833-900`).
- `acceptProposal` / `rejectProposal` (SIDRO): íbidem (`sidroAppointments.controller.ts:352-424`, `:426-479`).
- `linkAccount` / `createClientAndLink`: `processPendingRequestsForLink` emite `requestConfirmed` (confirmadas) y `linkConflict` (conflictos) dentro de la transacción de vinculación (`adminSidro.controller.ts:60-119`, `:157`, `:311+`).
- Cancelación de citas: `updateAppointment` y `deleteAppointment` cargan snapshots de solicitudes relacionadas, reconcilian el estado y luego `notifyCancelledSidroRequests` emite `appointmentCancelled` solo para solicitudes que pasaron de `CONFIRMADA` a `CANCELADA` (`appointments.controller.ts:46-73`, `:197-223`, `:248-256`).
- Consecuencia: si el INSERT de la notificación falla, **todo el evento hace ROLLBACK** (no hay cita/solicitud sin aviso, ni aviso sin entidad). Test Fase 8 nº 30 lo verifica; nº 13/15-19 verifican “insert antes de COMMIT”.
- Coste: cada `notifyPosStaff` hace 1 INSERT por destinatario (p. ej., owner+admin+reception+profesional = 4 filas). Es O(n destinatarios) dentro de la transacción; aceptable hoy, a considerar si Fase 9 añade push *inline* (no debería: ver guía).

## G. Seguridad

Definida en `src/middlewares/auth.middleware.ts`:

- JWT HS256, `issuer = 'pos-carmita-villegas'`, `audience = 'pos' | 'sidro'` (`POS_JWT_AUDIENCE` / `SIDRO_JWT_AUDIENCE`), claim `identity_type = 'pos_staff' | 'sidro_client'`.
- `verifyToken` valida firma, audiencia/identidad, usuario activo y `token_version` contra la tabla real (`users` o `sidro_client_accounts`). Tokens de audiencia incompatible → `401 'Token inválido o de identidad incorrecta'`. Hay compatibilidad temporal con tokens antiguos sin `aud` (fallback por `role === 'sidro_client'`).
- `requireStaff` exige `authIdentity === 'pos_staff'`; `requireSidroClient` exige `'sidro_client'`.
- Las rutas de notificaciones POS usan `router.use(verifyToken, requireStaff)` (`routes/notifications.routes.ts:7`) — **cualquier rol POS activo** (incluido professional) puede listar; el filtrado es siempre por `req.userId` propio.
- Las rutas de notificaciones SIDRO están tras `router.use(verifyToken, requireSidroClient)` (`routes/sidro.routes.ts:51,62-63`).
- Anti-enumeración: `markNotificationRead` solo actualiza si coincide `id + recipient_type + recipient_id`; si no existe **o es ajena** → `404`; repetir el marcado → `200 {changed:false}` (idempotente).
- No se aceptan `recipient_id`/`recipient_type` desde query/body (solo `limit`, `offset`, `unread`).
- Datos en `data`: solo `url` interna y `request_id`. No hay PII en las notificaciones (ni teléfono ni correo); el vínculo a la entidad es por `request_id`.

## Brechas conocidas (relevantes para Fase 9)

1. No hay reenvío/programación ni entrega fuera de la bandeja: sin push, sin email de “nueva notificación”, sin resumen por WhatsApp.
2. POS no es PWA y no tiene Service Worker (SIDRO sí). El push para POS exige decidir tecnología (SW propio vs. Firebase/otro).
3. No hay retención/limpieza (`expires_at` sin uso, sin TTL); sin paginación infinita en UI (20 POS / 10 SIDRO, sin “cargar más”).
4. Polling de 30 s por pestaña/clienta activa; el estado se limpia al cerrar sesión/destruir componente (no persiste contador entre dispositivos, es por usuario).
5. `NotificationInput.expiresAt` está listo para usarse, pero ningún evento lo usa.
