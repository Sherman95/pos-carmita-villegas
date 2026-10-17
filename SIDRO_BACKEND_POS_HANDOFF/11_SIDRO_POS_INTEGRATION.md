# Auditoría de integración SIDRO–POS

## Correcciones P1 aplicadas

- `SidroAdminService` usa `/api/admin/sidro`, coincidente con el montaje real.
- `sidro_account_id`, servicios y profesionales se manejan como UUID `string`;
  el ID de solicitud SIDRO continúa siendo `number`.
- El backend devuelve `end_time` en el listado y duración/padding en el
  catálogo público.
- El listado también devuelve `proposed_date`, `proposed_start_time` y
  `proposed_end_time` para el flujo de propuestas P2.
- No se modificaron tablas, restricciones ni estados persistidos.

| Área | Estado | Evidencia |
|---|---|---|
| URL administrativa Angular | CORREGIDO P1 | `sidro-admin.service.ts` usa `/api/admin/sidro` |
| Registro/login SIDRO | COMPATIBLE localmente | rutas y controlador usan teléfono, password y JWT |
| Servicios públicos | COMPATIBLE localmente | `/api/sidro/public/services` y profesionales |
| Disponibilidad | PARCIAL | backend devuelve `string[]`; PWA no está disponible para cotejar |
| Creación de solicitud | PARCIAL | backend espera `service_id`, `employee_id`, `request_date`, `start_time`; cliente externo no verificable |
| Estados | PARCIAL | código usa varios estados; SQL alternativo usa otros nombres |
| Vinculación | PARCIAL | transacción e índices declarados; UUID y solicitudes INTEGER están tipados correctamente |
| Aprobación/propuesta | PARCIAL | endpoints existen; contratos de frontend PWA no disponibles |
| Autorización | PARCIAL | backend verifica JWT/rol; POS sólo verifica autenticación de ruta |
| Google Calendar | AISLADO LOCAL | `GOOGLE_CALENDAR_ENABLED=false`; no se habilitó Calendar real |

## Pendientes para P3/P4

1. Validar en runtime local disponibilidad, vinculación, permisos y
   confirmación de citas.
2. Mantener la coexistencia de `sidro_appointment_requests` y
   `appointment_requests` hasta completar la trazabilidad de uso.
3. Ejecutar pruebas de concurrencia y regresión del POS sin habilitar Calendar
   real.
