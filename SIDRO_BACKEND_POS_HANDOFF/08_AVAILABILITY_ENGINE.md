# Motor de disponibilidad

Archivo: `backend/src/services/availability.engine.ts`.

## Algoritmo observado

1. Lee servicio, duración base y padding.
2. Obtiene el día de semana con `new Date(dateStr + 'T00:00:00')`.
3. Lee turnos `sidro_employee_schedules`.
4. Si hay bloqueo de día completo, devuelve vacío.
5. Consolida bloqueos, citas POS no canceladas y solicitudes en estados
   `CONFIRMADA` o `APROBADA_PENDIENTE_VINCULACION`.
6. Genera candidatos desde inicio de turno, cada 30 minutos, hasta que el fin
   del servicio quepa en el turno.
7. Rechaza candidatos pasados y solapados.

## Observaciones técnicas

- No incluye solicitudes `PENDIENTE`; dos clientas pueden seleccionar el mismo
  bloque antes de aprobación. Esto puede ser intencional, pero no es una reserva
  temporal documentada.
- `block_type` se lee pero no cambia la lógica.
- La fecha/hora depende de `Date` local y de una conversión manual a
  `America/Guayaquil`; hay riesgo de desfase si el proceso no usa la misma zona.
- No se valida explícitamente que el profesional esté asociado al servicio antes
  de usar la duración por defecto.
- El motor hace varias lecturas separadas y no mantiene un snapshot compartido
  con la inserción de solicitud.
- La respuesta es sólo `HH:mm`; no incluye duración, zona ni fecha.

## Veredicto

Es un generador de candidatos, no una garantía de reserva. La prevención final de
duplicados depende de las transacciones de aprobación/creación y de la calidad
del esquema real.
