# Resumen ejecutivo

El repositorio contiene un backend Express/TypeScript que combina el POS con una
API SIDRO y un frontend Angular POS que ya expone pantallas administrativas
SIDRO. La arquitectura es modular a nivel de carpetas y usa PostgreSQL con
transacciones en flujos importantes.

La implementación no está lista para certificarse como integración completa:

- La URL del servicio Angular administrativo no coincide con el prefijo del
  backend.
- Hay dos modelos SQL SIDRO incompatibles; el runtime usa la variante Phase 5.
- El motor de disponibilidad calcula candidatos, pero no garantiza por sí solo
  exclusión concurrente.
- Google Calendar tiene outbox/worker e idempotencia parcial, pero no se verificó
  el DDL completo ni el entorno.
- Seguridad requiere atención por secretos/fallbacks, CORS y contraseñas heredadas.
- La PWA SIDRO independiente y la base PostgreSQL real no están disponibles.

Prioridad: corregir contratos, congelar el esquema, probar concurrencia y
seguridad, y sólo después continuar la integración de calendario o despliegue.
