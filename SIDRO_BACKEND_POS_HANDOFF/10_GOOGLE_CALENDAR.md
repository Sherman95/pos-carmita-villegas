# Integración con Google Calendar

## Creación

Al crear una cita oficial se inserta un registro en
`google_calendar_sync_queue`. Cada 30 segundos, el worker toma hasta 10 trabajos,
marca `PROCESSING`, busca calendarios globales o del profesional y crea eventos
con `events.insert`.

El ID determinista se deriva de cita y calendario. La tabla
`appointment_google_events` con unique `(appointment_id, google_calendar_id)`
evita duplicados lógicos. Un HTTP 409 de Google se trata como evento ya creado y
se registra el ID determinista.

## Actualización y eliminación

`appointments.controller.ts` actualiza eventos sincronizados mediante `patch`.
En eliminación, el controlador borra primero la cita y sólo después consulta
`appointment_google_events`. Como esa relación declara `ON DELETE CASCADE`, la
consulta posterior puede no devolver filas y el evento remoto puede quedar
huérfano. La creación usa
`America/Guayaquil`; la actualización usa `toISOString()`, por lo que los
formatos de zona no son uniformes.

## Reintentos y fallos

Trabajos `FAILED` se reintentan si `attempts < 3`; trabajos `PROCESSING` de más
de cinco minutos vuelven a `PENDING`. El worker captura errores por trabajo y
marca `FAILED`. Si no hay configuración Google, retorna sin cambiar el trabajo,
dejándolo pendiente.

## Evidencia SQL

El esquema [pos_carmita_esquema_sin_datos.sql](../pos_carmita_esquema_sin_datos.sql)
contiene `google_calendar_sync_queue`, sus secuencias, PK y claves foráneas,
además de `appointment_google_events` y su unicidad por cita/calendario. Esto
confirma el soporte estructural de la cola y la idempotencia local, pero no
confirma credenciales, permisos ni eventos remotos.

## No verificable

No se hicieron llamadas reales, no se validó el contenido de credenciales ni se
verificó que el permiso del service account cubra cada calendario.

## Aislamiento local P0

El entorno local de pruebas quedó configurado con
`GOOGLE_CALENDAR_ENABLED=false`. `startGoogleCalendarWorker()` no crea el
intervalo cuando la bandera está deshabilitada y `getGoogleCalendarClient()`
devuelve `null`, evitando el uso de credenciales y llamadas externas. No se
inició el backend durante P0.
