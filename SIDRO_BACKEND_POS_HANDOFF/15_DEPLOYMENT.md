# Entornos y despliegue

## Declarado

Backend: `npm run build`, luego `node dist/index.js`; desarrollo con nodemon.
Frontend: `ng serve` o `ng build`. `frontend/src/environments/environment.prod.ts`
apunta a `https://pos-carmita-villegasv2.onrender.com`; desarrollo apunta a
`http://localhost:3000`.

`vercel.json` existe en raíz y frontend, pero no se inspeccionó un pipeline
completo. `backend/nodemon.json` existe. No hay evidencia suficiente para
describir Render/Vercel como despliegue operativo certificado.

## Variables esperadas

`PORT`, `NODE_ENV`, `JWT_SECRET`, `DATABASE_URL` o `DB_HOST/PORT/USER/PASSWORD/NAME`,
`DB_SSL` y configuración de Google usada por `googleAuth.controller.ts`.
Los valores nunca deben escribirse en esta documentación.

Condiciones P5 para una futura publicación:

- `JWT_SECRET` debe existir cuando `NODE_ENV=production`; no se permite el
  fallback de desarrollo.
- `CORS_ORIGINS` debe declarar la allowlist exacta de frontends autorizados.
- `GOOGLE_CALENDAR_ENABLED` debe permanecer `false` hasta completar una prueba
  de aceptación con un calendario aislado.
- Las cuentas POS con contraseñas heredadas en claro deben migrarse a bcrypt.

Condiciones P6 adicionales:

- Las rutas POS y de Calendar deben seguir autenticadas por JWT/rol.
- El rate limiting debe conservar almacenamiento compartido al desplegar
  múltiples instancias.
- Las pruebas móviles locales deben complementarse con una revisión manual en
  el dispositivo objetivo antes de publicar.

## P0 verificado en entorno local

El 2026-10-15 se verificó sin iniciar el servidor que la configuración activa del
backend apunta a `localhost:5432/poscarmitaVlocal`. La conexión PostgreSQL fue
comprobada mediante una consulta de identidad de solo lectura y devolvió la base
local autorizada. Se creó el respaldo local
`backend/backup_p0_local_20261015_203528.sql` usando PostgreSQL 18. No se
ejecutaron migraciones ni se alteraron tablas.

En `backend/.env` se añadió `GOOGLE_CALENDAR_ENABLED=false`. El worker y el
cliente Google respetan ahora esta bandera, por lo que el entorno local no debe
iniciar procesamiento ni llamadas externas de Calendar. El archivo de
credenciales existente no se utilizó.

## P3 verificado en ejecución

El backend se inició localmente con `npm run dev` y respondió
`GET http://localhost:3000/ping` con HTTP 200. El proceso registró
`Google Calendar deshabilitado para este entorno`. La identidad PostgreSQL fue
confirmada como `poscarmitaVlocal`, servidor `::1:5432`.

El primer intento de conexión automática del pool registró un timeout antes de
que una conexión posterior quedara operativa; `/ping` respondió correctamente
después del arranque. Este comportamiento debe investigarse antes de producción.

Se generó el respaldo `backend/backup_p3_local_20261015_210652.sql`. El
diagnóstico `scripts/check-database.js` fue corregido para no forzar SSL en
localhost.

## Procedimiento seguro recomendado

1. Verificar commit y cambios locales.
2. Validar esquema en una base efímera/de prueba.
3. Ejecutar build y pruebas con credenciales ficticias.
4. Desplegar backend y frontend con variables de entorno.
5. Confirmar `/ping`, autenticación y contratos sin mutar producción.
6. Mantener `GOOGLE_CALENDAR_ENABLED=false` en pruebas locales; habilitarlo sólo
   con un simulador o calendario sandbox autorizado.
