# Arquitectura del backend

## Stack y entrada

`backend/package.json` declara Node.js, TypeScript 5.9, Express 5.2, `pg`,
`jsonwebtoken`, `bcryptjs`, `argon2`, `cors`, `dotenv` y `googleapis`.
La entrada es `backend/src/index.ts`. `npm run dev` usa `ts-node --transpile-only`;
`npm run build` ejecuta `tsc`; `npm start` espera `dist/index.js`.

## Capas

| Capa | Ubicación | Responsabilidad |
|---|---|---|
| Arranque | `src/index.ts` | Express, middleware, rutas, worker |
| Rutas | `src/routes/` | Mapeo HTTP y guardias |
| Controladores | `src/controllers/` | HTTP, SQL y reglas de caso de uso |
| Servicios | `src/services/` | disponibilidad y creación transaccional |
| Persistencia | `src/database/db.ts` | pool PostgreSQL |
| Worker | `src/workers/googleCalendarWorker.ts` | cola de sincronización |
| Migraciones | `*.sql`, `src/database/migrate_expense_categories.ts` | DDL/ajustes |

## Middleware y errores

Express habilita CORS abierto, JSON/urlencoded hasta 1 MB y logging de duración.
`verifyToken` acepta `Authorization` o `x-access-token`. Existe un handler global
que responde 500, pero los controladores normalmente capturan sus errores.

No se observa validación de esquema (Zod, Joi o equivalente), rate limiting,
correlation IDs ni logger estructurado. La mayoría de SQL usa parámetros, pero
hay interpolación controlada para cláusulas opcionales.

## Rutas montadas

`/api/items`, `/api/sales`, `/api/clients`, `/api/auth`, `/api/expenses`,
`/api/cash`, `/api/reports`, `/api/employees`, `/api/appointments`,
`/api/sidro`, `/api/admin/sidro` y `/ping`.

## Configuración

`dotenv.config()` carga variables. Se soporta `DATABASE_URL` o `DB_HOST`,
`DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL`; `PORT`, `NODE_ENV` y
`JWT_SECRET` se leen directamente. El fallback de JWT es `dev-secret`, por lo
que no es aceptable para producción.
