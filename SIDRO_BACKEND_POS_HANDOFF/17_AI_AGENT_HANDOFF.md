# Instrucciones para agentes de IA

## Antes de modificar

- Leer este `README.md`, `12_IMPLEMENTATION_STATUS.md`, `04_DATABASE_SCHEMA.md`,
  `11_SIDRO_POS_INTEGRATION.md` y `13_TECHNICAL_DEBT.md`.
- Revisar `git status`; no revertir cambios ajenos.
- No asumir que SQL histórico está aplicado.
- No leer, copiar ni imprimir secretos.

## Reglas de cambio

- Mantener separados módulos POS y SIDRO.
- Reutilizar `AppointmentService` para citas oficiales; no duplicar comprobaciones.
- Mantener transacciones explícitas y hacer rollback/release en todos los caminos.
- Validar autorización en backend, no sólo en Angular.
- Cambiar contratos sólo con evidencia de backend y cliente.
- No ejecutar migraciones en producción.

## Verificación mínima

Build backend/frontend, pruebas focalizadas, prueba de contrato de URL, pruebas de
concurrencia en base aislada y revisión de diff. Documentar cualquier resultado
no verificable en vez de inferirlo.
