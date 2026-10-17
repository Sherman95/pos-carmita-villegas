# Referencia de API

Base backend: `http://<host>/api`. Autenticación: `Authorization: Bearer <JWT>`
salvo endpoints marcados públicos. Las respuestas de error son JSON `{ error }`,
con variaciones puntuales (`conflict`, `status`).

## SIDRO público y cliente

| Método | Ruta | Auth | Entrada | Respuesta |
|---|---|---|---|---|
| POST | `/sidro/register` | No | `nombre_completo`, `telefono`, `email?`, `password` | 201 cuenta sin hash |
| POST | `/sidro/login` | No | `telefono`, `password` | `{token}` de 7 días |
| GET | `/sidro/public/services` | No | — | servicios reservables |
| GET | `/sidro/public/services/:id/professionals` | No | id | profesionales activos |
| GET | `/sidro/profile` | SIDRO | — | perfil y vinculación |
| GET | `/sidro/availability` | SIDRO | `service_id`, `employee_id`, `request_date` | `string[]` HH:mm |
| POST | `/sidro/requests` | SIDRO | servicio, profesional, fecha, inicio | solicitud creada |
| GET | `/sidro/requests` | SIDRO | — | solicitudes de la cuenta |
| POST | `/sidro/requests/:id/accept-proposal` | SIDRO | id | confirmación |
| POST | `/sidro/requests/:id/reject-proposal` | SIDRO | id | mensaje |

## Administración SIDRO

Todas están bajo `/api/admin/sidro`, JWT y rol `admin` o `user`; varias restringen
además al administrador o al profesional dueño.

| Método | Ruta | Entrada/respuesta |
|---|---|---|
| GET | `/accounts` | lista cuentas y vínculos |
| POST | `/link` | `sidro_account_id`, `client_id`, `force?`; crea vínculo y procesa solicitudes |
| POST | `/users/:id/link-employee` | `employee_id` |
| GET/PUT | `/services/:id` | configuración y `professionals[]` |
| GET/PUT | `/employees/:employee_id/schedule` | horarios |
| GET | `/requests` | solicitudes filtradas por profesional si aplica |
| POST | `/requests/:id/accept` | aprobación/creación de cita |
| POST | `/requests/:id/reject` | rechazo |
| POST | `/requests/:id/propose` | `new_date`, `new_time` |

## POS y Calendar

`/api/appointments` protegido por JWT: GET colección, GET `/:id`, POST,
PUT `/:id`, DELETE `/:id`. POST acepta los campos de cita y `?force=true`.
`/api/auth/login` autentica POS. Bajo `/api/auth/google` existen listar, agregar,
eliminar calendario y sincronización manual.

## Evidencia de archivos

Rutas: `backend/src/routes/sidro.routes.ts`,
`backend/src/routes/adminSidro.routes.ts`,
`backend/src/routes/appointments.routes.ts`. Controladores:
`sidroAuth.controller.ts`, `sidroAppointments.controller.ts`,
`adminSidro.controller.ts` y `appointments.controller.ts`.
