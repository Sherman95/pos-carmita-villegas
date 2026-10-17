# Deuda técnica y riesgos

## Críticos antes de producción

1. Resolver la URL `/admin/sidro` frente a `/api/admin/sidro`.
2. Migrar a bcrypt las cuentas POS de producción. El fallback de contraseña en
   claro ya no existe en el código y las cuentas locales quedaron saneadas
   (P6.4), pero las cuentas de producción no han sido auditadas ni migradas; la
   migración local no implica que producción esté migrada.
3. Confirmar/migrar a un único esquema SIDRO.
4. Probar concurrencia y declarar una garantía real contra solapamientos.
5. Auditar el archivo de credenciales Google y mover secretos a variables/secret
   manager sin documentar valores.

La bandera local `GOOGLE_CALENDAR_ENABLED=false` reduce el riesgo durante las
pruebas, pero no sustituye la rotación y custodia segura de las credenciales
existentes.

## Alta prioridad

- Añadir validación de payload y fechas/horas, incluyendo timezone.
- Restringir `force` por rol y caso de uso.
- Unificar estados y contratos JSON.
- Hacer update/delete de citas transaccional y sincronización Calendar durable.
- La eliminación ahora recupera los vínculos locales antes del cascade; falta
  probar la confirmación remota con un simulador conectado al endpoint.
- Comparar el DDL de la cola del dump con el entorno desplegado y documentar una
  migración/rollback si difieren.

## Hallazgos P3 corregidos

- `adminSidro.controller.ts` ya no aplica `FOR UPDATE` sobre el lado nullable
  de un `LEFT JOIN`; bloquea la solicitud y consulta su vínculo en una segunda
  consulta dentro de la misma transacción.
- Las rutas SIDRO validan formato UUID y fecha/hora antes de consultar
  PostgreSQL.
- La aceptación de propuestas devuelve 403 para acceso horizontal no
  autorizado, en lugar de convertirlo en error 500.

## Riesgos observados en P3

- El arranque registró un timeout inicial del pool antes de recuperarse; se debe
  revisar el comportamiento de conexión/reintento.
- El worker de Calendar permanece desactivado localmente; la sincronización real
  sigue sin estar certificada.

## Media prioridad

- Logger estructurado y redacción de PII.
- Confirmar políticas operativas de secretos y rotación para Google Calendar.
- Tipos compartidos OpenAPI/TypeScript.
- Pruebas de integración y end-to-end.
- Eliminar scripts `scratch_*` o clasificarlos fuera del camino de despliegue.

## Hallazgos cerrados en P6

- Las rutas POS principales ya no son públicas; `clients`, `items` y `sales`
  requieren JWT.
- Las rutas de administración de Google Calendar requieren `admin`.
- `JWT_SECRET` es obligatorio y el fallback inseguro fue eliminado.
- `rate-limit` quedó migrado a un contador respaldado por PostgreSQL.
- `helmet` quedó habilitado para cabeceras base de seguridad.
- Fallback de contraseña en claro eliminado del login POS (bcrypt exclusivo).
- Cuentas locales heredadas de prueba (`emp1_test`, `emp2_test`) migradas a
  bcrypt y verificadas por login HTTP local (P6.4).
