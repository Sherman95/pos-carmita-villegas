# SIDRO – Backend y POS: handoff técnico

## Alcance y fecha

Auditoría estática del repositorio `Sherman95/pos-carmita-villegas`, realizada el
2026-10-15. Se inspeccionaron `backend/`, `frontend/`, manifiestos, SQL, pruebas y
configuración visible. No se ejecutaron migraciones, consultas de modificación ni
solicitudes a Google Calendar.

## Índice

1. [Arquitectura del sistema](./01_SYSTEM_ARCHITECTURE.md)
2. [Backend](./02_BACKEND_ARCHITECTURE.md)
3. [POS](./03_POS_ARCHITECTURE.md)
4. [Base de datos](./04_DATABASE_SCHEMA.md)
5. [API](./05_API_REFERENCE.md)
6. [Autenticación y seguridad](./06_AUTH_AND_SECURITY.md)
7. [Lógica de negocio](./07_BUSINESS_LOGIC.md)
8. [Disponibilidad](./08_AVAILABILITY_ENGINE.md)
9. [Concurrencia](./09_CONCURRENCY.md)
10. [Google Calendar](./10_GOOGLE_CALENDAR.md)
11. [Integración SIDRO/POS](./11_SIDRO_POS_INTEGRATION.md)
12. [Estado de implementación](./12_IMPLEMENTATION_STATUS.md)
13. [Deuda técnica](./13_TECHNICAL_DEBT.md)
14. [Pruebas](./14_TESTING.md)
15. [Despliegue](./15_DEPLOYMENT.md)
16. [Continuación](./16_CONTINUATION_PLAN.md)
17. [Handoff para agentes](./17_AI_AGENT_HANDOFF.md)
18. [Resumen ejecutivo](./18_EXECUTIVE_SUMMARY.md)

## Inventario auditado

| Proyecto | Ubicación | Evidencia |
|---|---|---|
| Backend POS + SIDRO | `backend/` | Node.js, Express 5, TypeScript, `src/index.ts` |
| POS administrativo | `frontend/` | Angular 21, rutas administrativas y componentes POS |
| PWA SIDRO separada | No encontrada en esta raíz | No hay otro proyecto/repo accesible |
| PostgreSQL | [pos_carmita_esquema_sin_datos.sql](../pos_carmita_esquema_sin_datos.sql) | Esquema consolidado disponible; no se inspeccionó una instancia |
| Google Calendar | Código de OAuth/worker y SQL | No se hicieron llamadas reales |

## Documentación previa

No se encontró `SIDRO_PROJECT_HANDOFF` dentro de esta raíz. Cuando se obtenga la
carpeta de la PWA, debe enlazarse junto a este índice y revisarse la matriz de
compatibilidad de `11_SIDRO_POS_INTEGRATION.md`.

## Lectura obligatoria antes de cambiar código

1. `12_IMPLEMENTATION_STATUS.md` y `13_TECHNICAL_DEBT.md`.
2. `04_DATABASE_SCHEMA.md`, antes de tocar SQL.
3. `05_API_REFERENCE.md` y `11_SIDRO_POS_INTEGRATION.md`, antes de tocar contratos.
4. `08_AVAILABILITY_ENGINE.md` y `09_CONCURRENCY.md`, antes de tocar reservas.
5. `14_TESTING.md` y el estado Git del desarrollador.
