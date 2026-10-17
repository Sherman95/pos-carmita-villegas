# Concurrencia y transacciones

## Protecciones existentes

- Creación de cita oficial ejecuta `SELECT ... FOR UPDATE` sobre el profesional,
  comprueba conflictos e inserta cita y trabajo de Calendar en una transacción
  proporcionada por el controlador.
- Aceptación de solicitud bloquea la solicitud con `FOR UPDATE`.
- Vinculación bloquea solicitudes retenidas y opera con `BEGIN/COMMIT`.
- El worker usa `FOR UPDATE OF q SKIP LOCKED`.
- Hay índices únicos para vínculos activos y para cita-calendario.

## Insuficiencias

El dump [pos_carmita_esquema_sin_datos.sql](../pos_carmita_esquema_sin_datos.sql)
confirma una exclusión GIST para la tabla alternativa `appointment_requests`,
pero el runtime consulta `sidro_appointment_requests`, que no tiene una
restricción equivalente. El bloqueo de la fila `employees` serializa creaciones
que usen el mismo profesional si todos los caminos pasan por
`AppointmentService`; no constituye una restricción declarativa sobre
`appointments`. Las actualizaciones de cita hacen comprobación y escritura con
consultas separadas sin transacción ni bloqueo equivalente. El motor de
disponibilidad tampoco reserva el slot.

La aprobación sin vínculo inserta una cita dummy y hace rollback para validar
conflicto, una técnica frágil: depende de FKs, de un UUID ficticio existente y de
que el rollback cubra exactamente las consultas. La documentación no puede
declarar ausencia de duplicados sin pruebas concurrentes y esquema real.

## Recomendación verificable

Añadir pruebas concurrentes que ejecuten dos aprobaciones para el mismo
profesional/intervalo y observar el resultado en una base de prueba. Evaluar una
restricción de exclusión de rangos para `appointments` y/o
`sidro_appointment_requests`, o un mecanismo de reserva temporal, después de
resolver la coexistencia de los dos modelos SQL.
