# Lógica de negocio

## Solicitudes

Una cuenta SIDRO puede tener como máximo tres solicitudes `PENDIENTE`. La hora
se valida contra disponibilidad y se calcula `end_time` con duración específica
del profesional o duración del ítem más padding.

Estados observados: `PENDIENTE`, `PROPUESTA`,
`APROBADA_PENDIENTE_VINCULACION`, `RECHAZADA`, `CONFIRMADA`,
`CONFLICTO_VINCULACION`; algunos aparecen sólo en código o comentarios.

## Aprobación y vinculación

- Con cuenta vinculada: aceptar crea una fila oficial en `appointments` y marca
  la solicitud `CONFIRMADA`.
- Sin vínculo: se hace una comprobación mediante inserción dummy y rollback; luego
  se marca `APROBADA_PENDIENTE_VINCULACION`.
- Al vincular, se desactivan vínculos previos, se crean los nuevos y se intenta
  convertir cada solicitud retenida. Los conflictos se marcan
  `CONFLICTO_VINCULACION`.

## Servicios y horarios

El administrador define `is_reservable`, duración, padding y profesionales.
Los horarios se reemplazan completamente al guardar. Un trigger SQL evita
solapamientos de turnos semanales en la variante Phase 5.

## Regla de compatibilidad

Estas reglas están implementadas en backend, pero no se pudo cotejar con la PWA
independiente ni con un contrato generado. La forma de los estados debe
centralizarse antes de ampliar clientes.
