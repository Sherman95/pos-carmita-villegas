# Matriz de Eventos → Notificaciones (Fase 8 + 8.5A)

> Todo lo listado aquí está **verificado en código** (backend `src/controllers/*`, `src/services/notificationTemplates.ts`,
> `src/services/notifications.service.ts`) y cubierto por `tests/notifications-whatsapp.phase8.test.cjs` (32 tests)
> y `tests/notifications-whatsapp.phase8.local-smoke.cjs`. Las rutas y permisos son los reales.

## Máquina de estados de la solicitud SIDRO

```
PENDIENTE ──proponer→ PROPUESTA ──clienta acepta──→ CONFIRMADA (si vinculada)
    │                     │                        └→ APROBADA_PENDIENTE_VINCULACION (si no vinculada)
    │                     └──clienta rechaza──→ CANCELADA
    ├──aprobar (POS)──→ CONFIRMADA (vinculada) | APROBADA_PENDIENTE_VINCULACION (no vinculada)
    ├──rechazar (POS)─→ RECHAZADA
    └──vincular (POS)─→ CONFIRMADA | CONFLICTO_VINCULACION (por conflicto de agenda)
```

Estados posibles en `sidro_appointment_requests.status`: `PENDIENTE`, `PROPUESTA`, `APROBADA_PENDIENTE_VINCULACION`,
`CONFIRMADA`, `RECHAZADA`, `CANCELADA`, `CONFLICTO_VINCULACION`.

## Matriz evento → template → destinatarios

| # | type (`notifications.type`) | Template (código) | Endpoint origen | Quién notifica | Destinatarios | `dedupe_key` | `data.url` |
| - | --------------------------- | ----------------- | --------------- | -------------- | ------------- | ------------ | ---------- |
| 1 | `sidro_request_created` | `requestCreated` | `POST /api/sidro/requests` (clienta) | `notifyPosStaff` + `notifyAssignedProfessional` | owner+admin+reception + profesional del `employee_id` | `req:<id>:created` | POS `/citas/solicitudes?open=<id>` |
| 2 | `sidro_request_confirmed` | `requestConfirmed` | `POST /api/admin/sidro/requests/:id/accept` (rama vinculada) y `POST /api/admin/sidro/link` / `/link/create-client` (al procesar pendientes) | `notifySidroAccount` | cuenta SIDRO dueña | `req:<id>:status:CONFIRMADA` | SIDRO `/my-requests?open=<id>` |
| 3 | `sidro_request_approved` | `requestApprovedPendingLink` | `POST /api/admin/sidro/requests/:id/accept` (rama sin vincular) | `notifySidroAccount` | cuenta SIDRO dueña | `req:<id>:status:APROBADA_PENDIENTE_VINCULACION` | SIDRO `/my-requests?open=<id>` |
| 4 | `sidro_request_needs_link` | `requestApprovedPendingLinkStaff` | ídem 3 | `notifyPosStaff` | owner+admin+reception | `req:<id>:status:APROBADA_PENDIENTE_VINCULACION` | POS `/citas/solicitudes?open=<id>` |
| 5 | `sidro_request_rejected` | `requestRejected` | `POST /api/admin/sidro/requests/:id/reject` | `notifySidroAccount` | cuenta SIDRO dueña | `req:<id>:status:RECHAZADA` | SIDRO `/my-requests?open=<id>` |
| 6 | `sidro_request_proposal` | `proposalSent` | `POST /api/admin/sidro/requests/:id/propose` | `notifySidroAccount` | cuenta SIDRO dueña | `req:<id>:status:PROPUESTA:<YYYY-MM-DD>:<HH:MM>` | SIDRO `/my-requests?open=<id>` |
| 7 | `sidro_proposal_accepted` | `proposalAccepted` | `POST /api/sidro/requests/:id/accept-proposal` (ambas ramas: vinculada y sin vincular) | `notifyPosStaff` | owner+admin+reception | `req:<id>:proposal-accepted` | POS `/citas/solicitudes?open=<id>` |
| 8 | `sidro_proposal_rejected` | `proposalRejected` | `POST /api/sidro/requests/:id/reject-proposal` | `notifyPosStaff` | owner+admin+reception | `req:<id>:proposal-rejected` | POS `/citas/solicitudes?open=<id>` |
| 9 | `sidro_request_link_conflict` | `linkConflict` | `POST /api/admin/sidro/link` / `/link/create-client` (solicitudes pendientes que chocan en agenda al vincular) | `notifyPosStaff` | owner+admin+reception | `req:<id>:status:CONFLICTO_VINCULACION` | POS `/citas/solicitudes?open=<id>` |
| 10 | `sidro_appointment_cancelled` | `appointmentCancelled` | `PUT /api/appointments/:id` (estado → `CANCELADA`) y `DELETE /api/appointments/:id` | `notifySidroAccount` | cuenta SIDRO de la solicitud relacionada | `req:<id>:status:CANCELADA` | SIDRO `/my-requests?open=<id>` |

Notas de la matriz:

- **#1**: el profesional solo recibe si existe un `users` activo con `role='professional'` y `employee_id` igual al de la solicitud (`notifications.service.ts:50-61`). En el peor caso: 3 staff + 1 profesional = 4 filas. Test nº 13.
- **#2**: se emite en dos rutas distintas con el mismo `dedupe_key`, por eso un reintento posterior no duplica (`ON CONFLICT DO NOTHING`). Tests nº 15 y 20.
- **#3/#4**: mismo `dedupe_key` pero distinto `recipient_type` (sin colisión entre sí: la clave única incluye `recipient_type` y `recipient_id`).
- **#6**: el `dedupe_key` incluye fecha+hora propuestas: si se propone un horario distinto, se crea otra notificación (correcto: la clienta debe enterarse del cambio). Si se repite la misma propuesta, no duplica.
- **#7**: en la rama “vinculada” además se crean las citas oficiales; en la “no vinculada” solo pasa a `APROBADA_PENDIENTE_VINCULACION`. La notificación al staff es idéntica en ambas.
- **#10**: `notifyCancelledSidroRequests` (`appointments.controller.ts:46-73`) solo avisa si el snapshot de la solicitud estaba `CONFIRMADA` **y** tras la reconciliación quedó `CANCELADA`. Si un solo segmento de una solicitud multi-servicio sigue activo, no hay aviso (test nº 16 de Fase 2, test nº 19 de Fase 8).
- Cancelar la propuesta desde SIDRO (`#8`) deja la solicitud en `CANCELADA` **sin** disparar `appointmentCancelled` (correcto: nunca hubo cita oficial).
- El botón/estado de WhatsApp oficial (Fase 8) **no genera notificaciones**: es una configuración de negocio (`business_config`, `PUT /api/settings/whatsapp-contact`) consumida por los botones `wa.me`. Tests nº 1-12 de Fase 8.

## Puntos de inserción exactos (para Fase 9: “dónde enganchar el push”)

| Evento | Archivo: línea | Contexto transaccional |
| ------ | -------------- | ---------------------- |
| requestCreated | `src/controllers/sidroAppointments.controller.ts:138-147` | dentro de `BEGIN…COMMIT` de creación (nº 149) |
| acceptProposal | `src/controllers/sidroAppointments.controller.ts:373-383` (rama vinculada) y `:405-415` (sin vincular) | dentro de la tx de aceptación |
| rejectProposal | `src/controllers/sidroAppointments.controller.ts:460-470` | ídem |
| requestConfirmed (aceptar) | `src/controllers/adminSidro.controller.ts:713-724` | tx de `acceptRequest` |
| requestApprovedPendingLink / Staff | `src/controllers/adminSidro.controller.ts:742-758` | tx de `acceptRequest` |
| requestRejected | `src/controllers/adminSidro.controller.ts:809-820` | tx de `rejectRequest` |
| proposalSent | `src/controllers/adminSidro.controller.ts:876-889` | tx de `proposeAlternativeRequest` |
| requestConfirmed / linkConflict (vinculación) | `src/controllers/adminSidro.controller.ts:107-116` (dentro de `processPendingRequestsForLink`, invocado en `linkAccount:157` y `createClientAndLink`) | tx de vinculación (`BEGIN` en `:133` / `:312`) |
| appointmentCancelled | `src/controllers/appointments.controller.ts:46-73` invocado en `updateAppointment:221` y `deleteAppointment:255` | tx de actualización/borrado de cita |

Regla para Code 9: **toda inserción de notificación usa el `PoolClient` de la tx del evento** (`insertForRecipient` recibe `client`, nunca `pool` directo). Cualquier efecto de push debe respetar esto o moverse a un outbox posterior al `COMMIT` (recomendación en la guía).

## Cobertura de tests (Fase 8, archivo `tests/notifications-whatsapp.phase8.test.cjs`, 32 tests)

- WhatsApp oficial: 01-12.
- Generación y dedupe: 13-20 (incluye “operación repetida no duplica” y “fallo de notificación → rollback”).
- Lectura/aislamiento: 21-29 (propias/ajenas, paginación, contadores, tokens inválidos).
- Integridad y frontends: 30-32 (rollback, no duplicar entidades, polling detenido al cerrar sesión, indicadores de UI).

Smoke local (BD real, `tests/notifications-whatsapp.phase8.local-smoke.cjs`): verifica tabla/índices/constraint de dedupe reales y endpoints contra `poscarmitaVlocal`.
