# Plan de continuación

1. Obtener `SIDRO_PROJECT_HANDOFF` y la PWA SIDRO real.
2. Congelar el contrato API y corregir la URL administrativa.
3. Elegir Phase 5 o la migración alternativa; generar una migración única
   revisada y un rollback, sin aplicarla hasta aprobarla.
4. Inspeccionar PostgreSQL en sólo lectura: tablas, constraints, índices y tipos.
5. Añadir validación, estados y tipos compartidos.
6. Diseñar prueba de concurrencia y decidir exclusión de rangos/reserva.
7. Completar create/update/delete de Calendar con outbox durable e idempotencia.
8. Ejecutar matriz de pruebas en staging.
9. Revisar seguridad de secretos, JWT, CORS y logs.
10. Actualizar esta documentación con hashes de commit y resultados reproducibles.
