# Pruebas

## Artefactos existentes

Se localizaron `backend/test_availability.ts`, `test_sidro.ts`,
`test_backend_flow.js`, `test_http.js` y `test_restore.js`. No hay script de
prueba backend declarado en `package.json`; sólo `build`, `dev`, `start` y
`db:check`. El frontend declara `ng test` y contiene al menos una prueba de
aplicación y una de gastos.

## No ejecutado

No se ejecutaron tests ni scripts porque algunos pueden requerir PostgreSQL,
credenciales o restauración de datos, y la solicitud exige no modificar bases ni
entorno. Su existencia no demuestra éxito.

## Preparación P0

Se verificó la conexión de solo lectura a `localhost:5432/poscarmitaVlocal` y
se creó un respaldo actualizado antes de continuar. Las pruebas que arranquen
el backend deben conservar `GOOGLE_CALENDAR_ENABLED=false` o inyectar un
simulador explícito. No se ejecutaron scripts de prueba en esta fase porque
algunos pueden insertar, eliminar o restaurar datos.

## P3 ejecutado localmente

El 2026-10-15 se ejecutó
`backend/test_p3_runtime.js` contra `localhost:3000` y
`poscarmitaVlocal`, usando únicamente datos ficticios temporales y limpieza
verificada al finalizar. Se creó el respaldo
`backend/backup_p3_local_20261015_210652.sql`.

Resultados comprobados:

- `/ping`, registro, login, perfil, catálogo, profesionales y disponibilidad:
  correctos.
- Dos solicitudes `PENDIENTE` simultáneas: aceptadas, conforme a la regla
  vigente de que ese estado no bloquea citas.
- Duración de 30 minutos más padding de 15 minutos: `end_time` de 45 minutos.
- Bloqueo parcial, bloqueo de día completo y día sin horario: respetados.
- Vinculación administrativa y aprobación: cita oficial creada
  transaccionalmente.
- Segunda aprobación solapada: rechazada con HTTP 409.
- JWT ausente: 403; JWT expirado: 401; cliente SIDRO y profesional sin rol
  admin: 403; acceso horizontal a solicitudes: aislado por cuenta.
- Payload e identificadores inválidos: HTTP 400.
- Rechazo de propuesta: correcto.

Después de la prueba se verificó que las cuentas, solicitudes, vínculos,
horarios, bloqueos, usuarios administrativos temporales, citas y eventos de
cola creados por P3 fueron eliminados o restaurados. No se contactó Google
Calendar.

## P4 ejecutado localmente

El 2026-10-16 se ejecutó una validación E2E visual contra:

- Backend `localhost:3000`
- POS `localhost:4200`
- PWA `localhost:4201`
- PostgreSQL local `poscarmitaVlocal`

Calendar permaneció desactivado (`GOOGLE_CALENDAR_ENABLED=false`). Resultados:

| ID | Caso | Resultado | Evidencia |
|---|---|---|---|
| P4-01 | Registro, login, dashboard y guard de sesión | PASS | Navegación real en PWA; `/my-requests` sin sesión redirige a `/login` |
| P4-02 | Servicio → profesional → fecha → horario → solicitud | PASS | Solicitud visible en PWA y en `sidro_appointment_requests` |
| P4-03 | Doble clic al confirmar | PASS | Se creó una sola solicitud para el primer flujo |
| P4-04 | Bandeja administrativa | PASS | Solicitud visible en `/sidro/requests` después de corregir `NG0100` |
| P4-05 | Vinculación y aprobación | PASS | Estado `CONFIRMADA`; una cita oficial vinculada |
| P4-06 | Propuesta y rechazo | PASS | `PENDIENTE` → `PROPUESTA` → `CANCELADA` desde ambas interfaces |
| P4-07 | Regresión visual POS | PASS | Clientes, profesionales, catálogo, citas, historial y caja cargaron sin redirección |
| P4-08 | Google Calendar real | BLOCKED/INTENCIONAL | Worker y cliente desactivados; no se envió evento externo |

La solicitud aprobada se comprobó en PostgreSQL con un único
`official_appointment_id`. Las dos solicitudes y las dos cuentas ficticias de
P4, el usuario administrativo temporal, el vínculo, el horario, la relación
servicio-profesional, la cita y su fila de cola fueron eliminados al finalizar.
El servicio temporal fue restaurado a `is_reservable=false`,
`duration_minutes=NULL`, `padding_minutes=0`. La solicitud preexistente con
ID 1 permaneció.

Durante P4 se corrigieron dos errores de detección de cambios Angular en las
vistas administrativas SIDRO, en
`frontend/src/app/components/sidro-requests/sidro-requests.component.ts` y
`frontend/src/app/components/sidro-settings/sidro-settings.component.ts`.
No se ejecutaron migraciones ni se modificó el esquema.

## Matriz pendiente

- Unitarias: duración/padding, zona horaria, límites de solicitudes, estados.
- Integración: cada endpoint con esquema Phase 5.
- Concurrencia: doble aprobación, doble vinculación, doble creación.
- Contrato: URL Angular, UUID vs number, payloads y errores.
- Calendar: idempotencia 409, retry, stale processing, patch/delete.
- Seguridad: JWT expirado, rol cruzado, inputs inválidos, rate limiting.
- E2E: flujo registro → solicitud → propuesta → vínculo → cita → Calendar.

## P5 ejecutado localmente

La validación final se ejecutó únicamente contra `poscarmitaVlocal`, con
Calendar simulado y sin llamadas externas.

| ID | Prueba | Resultado | Evidencia |
|---|---|---|---|
| P5-01 | Aceptación de propuesta | PASS | `PROPUESTA` → `CONFIRMADA`, horario 10:00–10:45 y exactamente una cita |
| P5-02 | Rechazo de propuesta | PASS | Ejecutado en P4: `PROPUESTA` → `CANCELADA` |
| P5-03 | Dos aprobaciones simultáneas incompatibles | PASS | HTTP 200 + HTTP 409; una sola cita oficial; rollback del conflicto |
| P5-04 | Calendar: error de red y retry | PASS | Primera ejecución `FAILED`, segundo intento `COMPLETED` |
| P5-05 | Calendar: idempotencia | PASS | Dos intentos de inserción, una sola fila en `appointment_google_events` |
| P5-06 | JWT de producción sin secreto | PASS | El módulo rechaza iniciar cuando `NODE_ENV=production` y falta `JWT_SECRET` |
| P5-07 | `force=true` con rol no administrador | PASS | HTTP 403 |
| P5-08 | CORS no permitido | PASS | Origin externo sin `access-control-allow-origin` |
| P5-09 | Regresión visual POS/PWA | PASS | Módulos principales cargados en P4; suite PWA 17/17 |

Correcciones P5:

- `JWT_SECRET` es obligatorio en producción; el fallback `dev-secret` queda
  restringido al entorno no productivo.
- Las contraseñas POS heredadas en claro ya no son aceptadas cuando
  `NODE_ENV=production`; la migración de las cuentas restantes a bcrypt sigue
  siendo requisito de publicación.
- CORS usa allowlist y `CORS_ORIGINS`; local permite únicamente los puertos
  4200 y 4201 por defecto.
- `force=true` requiere rol `admin`.
- La eliminación de citas lee los vínculos de Calendar antes del borrado para
  no perderlos por cascada.

No hubo migraciones ni cambios de esquema. Los fixtures P5 fueron eliminados y
`pruebaa` quedó restaurado a `is_reservable=false`,
`duration_minutes=NULL`, `padding_minutes=0`.

### Riesgos abiertos P5

- No se certificó una llamada real a Google Calendar, por restricción explícita.
- `googleAuth.controller.ts` todavía requiere una política operativa de
  credenciales, rotación y secreto administrado.
- Deben migrarse las cuentas POS restantes cuyo hash no sea bcrypt antes de
  producción.
- No hay rate limiting implementado para login/registro.
- La eliminación remota de eventos todavía requiere una prueba de aceptación
  con un proveedor simulado integrado al endpoint de borrado.

## P6 ejecutado localmente

La fase de endurecimiento se ejecutó exclusivamente con base local
`poscarmitaVlocal`, respaldada antes de los cambios.

| ID | Prueba | Resultado | Evidencia |
|---|---|---|---|
| P6-01 | Login POS con hash moderno | PASS | Usuario de prueba con bcrypt autenticó correctamente |
| P6-02 | Login POS inválido | PASS | Contraseña incorrecta devolvió HTTP 401 |
| P6-03 | Login SIDRO | PASS | Cuenta móvil ficticia autenticó correctamente |
| P6-04 | Registro SIDRO y rate limit | PASS | Tras varios intentos, el registro/login devolvió HTTP 429 |
| P6-05 | Acceso sin JWT a clientes POS | PASS | HTTP 403 |
| P6-06 | Google Calendar administrado por admin בלבד | PASS | SIDRO client recibió HTTP 403 |
| P6-07 | Calendar: eliminación con adaptador simulado | PASS | El evento remoto se intentó borrar antes del borrado local |
| P6-08 | Validación móvil PWA | PASS | Emulación de 390x844 con capturas en login, dashboard, reservas y solicitudes |
| P6-09 | Propuesta alternativa en móvil | PASS | `PENDIENTE` → `PROPUESTA` → `CONFIRMADA` desde PWA móvil emulada |
| P6-10 | Compilaciones de backend, POS y PWA | PASS | Las tres compilaciones terminaron correctamente tras los cambios |
| P6-11 | Suite unitaria PWA | PASS | `17 SUCCESS` en ChromeHeadless |

Correcciones P6:

- `JWT_SECRET` ahora es obligatorio y debe medir al menos 32 caracteres.
- Las rutas POS (`clients`, `items`, `sales`) quedaron protegidas por JWT.
- Las rutas de Google Calendar requieren rol `admin`.
- El rate limiting quedó respaldado por PostgreSQL local, no por memoria.
- Se añadió `helmet` y se mantuvo `CORS_ORIGINS` como allowlist explícita.
- La eliminación de citas obtiene primero los eventos asociados y solo luego
  borra la cita local, evitando perder el enlace de sincronización.
- Se probó la validación móvil con capturas de navegador; no equivale a Safari
  iOS real.

No quedaron registros ficticios P6 ni cambios de esquema permanentes.

### Riesgos abiertos P6

- Google Calendar real sigue desactivado; falta una prueba con sandbox aislado.
- La migración de todas las contraseñas heredadas del POS a bcrypt debe
  completarse para eliminar cualquier dependencia transitoria.
- La validación móvil fue en emulación Chromium; no sustituye una prueba real
  sobre iOS Safari.
- Debe establecerse una política operativa de secretos y rotación para la
  cuenta de Calendar.
