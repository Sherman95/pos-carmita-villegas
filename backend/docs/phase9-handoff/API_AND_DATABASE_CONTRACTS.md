# Contratos de API y Base de Datos — Notificaciones Fase 8 (para Fase 9)

> Contratos **reales** verificados contra código y `poscarmitaVlocal`. Si Fase 9 los extiende, debe
> mantener compatibilidad hacia atrás con estos shapes (los frontends POS/SIDRO ya los consumen tal cual).

## 1. Autenticación (aplica a todo lo de abajo)

- Header: `Authorization: Bearer <jwt>` (también acepta `x-access-token`).
- JWT HS256; `iss = 'pos-carmita-villegas'`; `aud = 'pos'` (personal) o `'sidro'` (clientas);
  claims: `sub` (UUID), `role`, `identity_type = 'pos_staff' | 'sidro_client'`, `token_version`, `exp`.
- `verifyToken` valida firma + audiencia/identidad + usuario existente/activo + `token_version`.
  - Token POS contra ruta SIDRO → `403 {"error":"Acceso exclusivo para cuentas SIDRO"}`.
  - Token SIDRO contra ruta POS → `403 {"error":"Acceso exclusivo para personal del POS"}`.
  - Firma/expiración/versión → `401` (`'Token inválido o expirado'` / `'La sesión expiró. Inicia sesión nuevamente'`).

## 2. Endpoints de bandeja (los únicos que existen)

### 2.1 POS — `GET /api/notifications`

- Middleware: `verifyToken`, `requireStaff` (`routes/notifications.routes.ts:7`). Cualquier rol POS (owner/admin/reception/professional).
- Query params:
  - `limit` → entero; se clampea a **1..50**; default **20**.
  - `offset` → entero ≥ 0; default 0.
  - `unread` → `'true'` (case-insensitive) filtra `read_at IS NULL`.
- Orden: `created_at DESC, id DESC`.
- `200`:
```json
{
  "items": [
    {
      "id": 12,
      "type": "sidro_request_created",
      "title": "Nueva solicitud SIDRO",
      "body": "Ana Perez solicitó Coloracion para el 05/11/2026 a las 09:00.",
      "data": { "url": "/citas/solicitudes?open=501", "request_id": 501 },
      "read_at": null,
      "created_at": "2026-10-18T20:33:30.385Z"
    }
  ],
  "total": 3,
  "unread": 1,
  "limit": 20,
  "offset": 0
}
```
- `total`/`unread` son del **destinatario completo**, no del filtro (`unread=true` no cambia `total`).
- Errores: `401` token ausente/ inválido / usuario inactivo; `403` identidad SIDRO; `500` `'No se pudieron consultar las notificaciones'`.

### 2.2 POS — `POST /api/notifications/:id/read`

- `:id` debe ser entero > 0; si no → `400 {"error":"Notificación inválida"}`.
- Solo actualiza si `id + recipient_type('pos_user') + recipient_id(req.userId)` coinciden y `read_at IS NULL`.
- `200 {"id":12,"read_at":"2026-10-18T21:00:00.000Z","changed":true}`.
- Repetido (ya leída) → `200 {..., "changed":false}` (idempotente).
- Ajena o inexistente → **`404 {"error":"Notificación no encontrada"}`** (no distingue “ajena” de “no existe”: anti-enumeración).
- `401` como arriba; `500` `'No se pudo actualizar la notificación'`.

### 2.3 SIDRO — `GET /api/sidro/notifications` y `POST /api/sidro/notifications/:id/read`

- Middleware: `verifyToken`, `requireSidroClient` (`routes/sidro.routes.ts:51,62-63`).
- **Mismos** query params, shapes y códigos que 2.1/2.2, con `recipient_type = 'sidro_account'` y `recipient_id = <sidro_client_accounts.id>`.
- No existe endpoint para: listar suscripciones push, registrarse a push, borrar notificaciones, “marcar todas como leídas”, ni reenviar.

## 3. Endpoints que **generan** notificaciones (contrato de efectos)

| Endpoint | Auth / permiso | Body relevante | Éxito | Efecto de notificación | Errores típicos |
| -------- | -------------- | -------------- | ----- | ---------------------- | --------------- |
| `POST /api/sidro/requests` | clienta SIDRO | `{service_id, employee_id, request_date, start_time, client_notes?}` | `201` fila de solicitud + `services` | `sidro_request_created` → staff + profesional | `409` horario no disponible; `429` >3 pendientes; `400` validación |
| `POST /api/admin/sidro/requests/:id/accept` | staff con `sidro_requests.manage` (owner/admin/reception) o `manage_own` (professional, solo propias) | — | `200 {message,status}` | Vinculada → `sidro_request_confirmed` (SIDRO). Sin vincular → `sidro_request_approved` (SIDRO) + `sidro_request_needs_link` (staff) | `403` no propia; `409` estado inválido |
| `POST /api/admin/sidro/requests/:id/reject` | ídem | — | `200 {message}` | `sidro_request_rejected` (SIDRO) | `404`, `409` ya procesada |
| `POST /api/admin/sidro/requests/:id/propose` | ídem | `{new_date, new_time}` | `200 {message}` | `sidro_request_proposal` (SIDRO) | `409` no pendiente |
| `POST /api/sidro/requests/:id/accept-proposal` | clienta SIDRO (dueña, estado `PROPUESTA`) | — | `200 {message, appointment_ids?}` | `sidro_proposal_accepted` → staff | `403/409` si cambió de estado |
| `POST /api/sidro/requests/:id/reject-proposal` | clienta SIDRO (dueña, estado `PROPUESTA`) | — | `200 {message}` | `sidro_proposal_rejected` → staff | `403` no autorizado |
| `POST /api/admin/sidro/link` | staff con `sidro_accounts.link` (owner/admin) | `{sidro_account_id, client_id, force?}` | `200 {message,id,confirmed_requests[],conflicts[]}` | `requestConfirmed` por cada pendiente confirmada (SIDRO) y `linkConflict` por conflicto (staff) | `409` cliente ya vinculado a otra cuenta (sin `force`) |
| `POST /api/admin/sidro/link/create-client` | ídem | `{sidro_account_id, nombre, cedula|documento, telefono, email, direccion}` | `201 {message,client,link_id,confirmed_requests[],conflicts[]}` | ídem link | `400` validaciones; `409` duplicado cédula/correo o ya vinculada; `23505` → `409` |
| `PUT /api/appointments/:id` | `appointments.update` u `update_own` | `{..., estado}` (p. ej. `CANCELADA`) | `200` cita actualizada | `sidro_appointment_cancelled` (SIDRO) si una solicitud relacionada pasó de `CONFIRMADA` a `CANCELADA` | `403` datos operativos para professional; `409` conflicto horario |
| `DELETE /api/appointments/:id` | `appointments.cancel` (owner/admin/reception) | — | `200 {message}` | ídem cancelación | `404` |

Notas:

- Los permisos son los reales de `src/security/rbac.ts`: owner (todo), admin (`sidro_requests.manage`, `sidro_accounts.link`, cancelar citas…), reception (`sidro_requests.manage`, cancelar citas), professional (`sidro_requests.manage_own`, `appointments.update_own`; **no** `appointments.cancel` — pero sí puede poner `estado='CANCELADA'` en su propia cita vía `PUT`, lo que puede disparar el aviso a la clienta).
- Auditoría: `linkAccount` y `createClientAndLink` registran `SIDRO_ACCOUNT_LINKED` / `SIDRO_CLIENT_CREATED_AND_LINKED` con `target_user_id = NULL` y `link_id` en metadata, **dentro de la misma transacción** (ajuste 8.5A; antes pasaba el `link_id` como `target_user_id` y violaba la FK `admin_audit_log.target_user_id → users(id)` con `23503`).
- Todos los avisos se insertan con la conexión de la transacción del endpoint (ver `NOTIFICATIONS_ARCHITECTURE.md §F`).

## 4. Contrato de base de datos (tabla `notifications`)

DDL canónico (idempotente): `notifications_phase8.sql` y `initNotificationsPhase8Table()` en `src/database/migrateNotificationsPhase8.ts` (se ejecuta en cada arranque del server, `src/index.ts:137`).

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  recipient_type VARCHAR(16) NOT NULL CHECK (recipient_type IN ('pos_user', 'sidro_account')),
  recipient_id TEXT NOT NULL,
  type VARCHAR(64) NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  CONSTRAINT notifications_recipient_dedupe_unique UNIQUE (recipient_type, recipient_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS notifications_recipient_created_idx
  ON notifications (recipient_type, recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
  ON notifications (recipient_type, recipient_id)
  WHERE read_at IS NULL;
```

Definiciones reales en `poscarmitaVlocal` (por si Fase 9 necesita `IF NOT EXISTS` booleano):

- `notifications_recipient_type_check`: `CHECK ((recipient_type)::text = ANY (ARRAY['pos_user'::character varying, 'sidro_account'::character varying]::text[]))`
- `notifications_recipient_dedupe_unique`: `UNIQUE (recipient_type, recipient_id, dedupe_key)` (índice único `notifications_recipient_dedupe_unique`)
- `notifications_pkey`: `PRIMARY KEY (id)`
- Índices: `notifications_recipient_created_idx (recipient_type, recipient_id, created_at DESC)`, `notifications_recipient_unread_idx (recipient_type, recipient_id) WHERE read_at IS NULL`

Reglas de escritura:

- INSERT único del sistema: `INSERT INTO notifications(...) VALUES (...) ON CONFLICT (recipient_type, recipient_id, dedupe_key) DO NOTHING` (una fila por destinatario; `notifyPosStaff` itera).
- **Sin FK en `recipient_id`** (es `TEXT` polimórfico; `users.id` o `sidro_client_accounts.id`).
- `id` es `BIGINT` (serializado como número JSON por `pg` en la práctica del proyecto; el frontend lo tipa `number`).
- `type` sin CHECK (≤64 chars por tipo de columna).
- `expires_at` soportado por el servicio (`NotificationInput.expiresAt`) pero **no usado por ningún evento actual** (siempre `NULL`); no hay limpieza automática.
- Para Fase 9: cualquier tabla nueva (p. ej. `push_subscriptions`, outbox de push) debe ser aditiva, idempotente y seguir el patrón de migración en arranque + SQL de referencia en la raíz del backend (como `notifications_phase8.sql`).

## 5. Contrato de transaccionalidad

- `insertForRecipient(client, …)` recibe `PoolClient` obligatorio. Los 10 eventos lo llaman con la conexión de su `BEGIN`.
- Si el INSERT de notificación falla → la excepción burbujea → el controller hace `ROLLBACK` → no queda ni entidad ni aviso (test Fase 8 nº 30).
- Fase 9 **no debe** romper esta invariante para la bandeja; el push (entrega externa) debe ser post-`COMMIT` (outbox), para no acoplar la disponibilidad del transporte con la creación de citas.
