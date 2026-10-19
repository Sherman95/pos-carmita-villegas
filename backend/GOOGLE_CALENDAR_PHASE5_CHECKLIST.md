# Checklist productivo — Google Calendar Fase 5

Documento preparatorio. No ejecutar hasta revisar y autorizar explícitamente el despliegue.

## Orden futuro de despliegue

1. Respaldar la base productiva y registrar los conteos de las consultas de solo lectura siguientes.
2. Aplicar `google_calendar_phase5.sql` en Supabase. Es aditiva e idempotente; no elimina la cola ni los vínculos existentes.
3. Desplegar el backend con `GOOGLE_CALENDAR_ENABLED=false` y comprobar inicio, salud y esquema.
4. Confirmar que `GOOGLE_CREDENTIALS_PATH` apunta al Secret File correcto y que la cuenta técnica tiene permiso para modificar cada calendario.
5. Cambiar `GOOGLE_CALENDAR_ENABLED=true` y reiniciar una sola instancia.
6. Verificar en logs el mensaje `[GCAL][WORKER] Iniciado (cada 30s)`.
7. Crear una cita controlada futura desde POS y comprobar sus tres destinos.
8. Aprobar una solicitud SIDRO controlada y comprobar que solo la cita oficial genera trabajos.
9. Reprogramar y cancelar únicamente las citas de prueba; confirmar el mismo `google_event_id` por calendario y la eliminación correcta.
10. Ejecutar sincronización manual solo sobre una cita de prueba ya sincronizada y comprobar que no crea duplicados.

## Consultas de solo lectura para Supabase

```sql
SELECT id, calendar_id, employee_id, description, created_at
FROM google_calendars
ORDER BY id;

SELECT status, operation, count(*) AS total,
       min(created_at) AS oldest, max(updated_at) AS latest
FROM google_calendar_outbox
GROUP BY status, operation
ORDER BY status, operation;

SELECT id, appointment_key, google_calendar_id, calendar_id_snapshot,
       operation, status, attempts, next_attempt_at,
       last_error_code, left(last_error, 200) AS error_excerpt,
       created_at, updated_at
FROM google_calendar_outbox
WHERE status IN ('PENDING', 'PROCESSING', 'FAILED_RETRY', 'FAILED_PERMANENT')
ORDER BY created_at
LIMIT 200;

SELECT appointment_id, google_calendar_id, google_event_id
FROM appointment_google_events
ORDER BY google_calendar_id, appointment_id
LIMIT 200;

SELECT status, count(*) AS total,
       min(created_at) AS oldest, max(updated_at) AS latest
FROM google_calendar_sync_queue
GROUP BY status
ORDER BY status;
```

## Filtros concretos de Render

- `[GCAL][WORKER] Iniciado`
- `[GCAL][WORKER] Procesando`
- `[GCAL][WORKER] Evento creado`
- `[GCAL][WORKER] Evento actualizado`
- `[GCAL][WORKER] Evento eliminado`
- `[GCAL][WORKER] Evento remoto recuperado`
- `[GCAL][WORKER] Fallo de destino`
- `GOOGLE_NOT_CONFIGURED`
- `STALE_PROCESSING`

Los códigos `401/403` apuntan a credenciales o permisos; `429/5xx` deben pasar por reintento limitado. Los logs no deben mostrar claves, tokens ni datos personales.

## Comprobaciones externas manuales

- Los tres calendarios generales esperados aparecen una sola vez en `google_calendars` y sin `employee_id`.
- La cuenta técnica está compartida como editora en cada calendario.
- Una cita de las 15:00 de Ecuador contiene el instante `20:00:00Z` y se visualiza a las 15:00 con `America/Guayaquil`.
- Cada cita controlada produce tres vínculos independientes, uno por calendario.
- Un destino con fallo no cambia a completados los demás ni bloquea su procesamiento.

## Recuperación selectiva de históricos

1. No reprocesar masivamente `google_calendar_sync_queue`.
2. Identificar una sola cita y un solo calendario fallidos mediante las consultas de lectura.
3. Comprobar primero `appointment_google_events` y buscar el ID determinístico o vínculo existente en Google.
4. Si el evento existe, registrar/reconciliar el vínculo mediante una herramienta revisada antes de reintentar.
5. Si no existe, usar la sincronización manual administrativa del calendario para encolar la cita con la misma lógica idempotente.
6. Observar el trabajo hasta `COMPLETED`; detenerse ante `FAILED_PERMANENT` y resolver permisos antes de continuar.
7. Ampliar el procedimiento a más citas solo con autorización explícita y en lotes pequeños auditables.

