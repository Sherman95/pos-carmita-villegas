# Fase 7 — guía de migración futura

Este documento prepara un despliegue posterior. No autoriza ni ejecuta cambios en producción.

## Orden coordinado

1. Confirmar respaldo verificable de PostgreSQL y versión actualmente desplegada.
2. Aplicar `sidro_auth_phase4.sql` si aún está pendiente.
3. Aplicar `google_calendar_phase5.sql` si aún está pendiente.
4. Aplicar `rbac_phase6.sql` si aún está pendiente.
5. Verificar y completar el bootstrap del propietario con UUID real, rol `owner`, cuenta activa y acceso probado.
6. Aplicar `cash_control_phase7.sql`.
7. Desplegar el backend compatible.
8. Verificar salud, autenticación POS/SIDRO y la lectura de `/api/settings/cash-control`.
9. Desplegar el frontend POS. SIDRO no necesita funcionalidad de caja.
10. Mantener inicialmente `cash_control_enabled=true`. Cambiarlo solo desde el POS y después de cerrar correctamente cualquier caja abierta.

## Verificaciones SQL previas y posteriores

```sql
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema='public'
  AND ((table_name='sales' AND column_name='usuario_id')
    OR (table_name='payment_history' AND column_name='usuario_id'));

SELECT config_key, config_value, updated_at
FROM public.business_config
WHERE config_key='cash_control_enabled';

SELECT id, fecha_apertura, usuario_id
FROM public.cash_registers
WHERE estado='ABIERTO';
```

El valor ausente se interpreta como `true` por compatibilidad. La migración también inserta `true` sin sobrescribir una decisión existente.

## Controles de acceso

- Verificar una cuenta `owner` activa antes de desplegar.
- Confirmar que `owner` recibe `cash.settings.manage` y que `admin`, `reception`, `professional` y `sidro_client` no lo reciben.
- Probar `/api/auth/me` y la administración de usuarios antes de cambiar el modo.
- Las cuentas SIDRO no se alteran: la migración no modifica `sidro_client_accounts`, enlaces, contraseñas ni tokens.

## Caja productiva abierta

No cerrar ni modificar una caja mediante SQL. Si existe una caja abierta, el backend rechaza la desactivación con HTTP 409. Debe cerrarse desde el flujo habitual, con arqueo calculado por el servidor, y recién después desactivar el requisito.

## Activación gradual

1. Desplegar manteniendo `true`.
2. Verificar una venta, abono, gasto, reporte y cierre normal.
3. Cerrar la caja de forma ordinaria.
4. Desactivar desde Configuración con la propietaria.
5. Probar operaciones controladas y reportes sin crear caja.
6. Para reactivar, cambiar a `true` y abrir una caja nueva; los movimientos anteriores no se importan a esa sesión.

## Reversión

El código puede revertirse conservando las columnas y la fila de configuración: son aditivas y no alteran movimientos históricos. Antes de volver a un backend antiguo, establecer `cash_control_enabled=true` y comprobar una caja abierta conforme al flujo antiguo. No eliminar `usuario_id`, pagos, ventas ni auditorías. Una reversión destructiva de esquema no es necesaria.
