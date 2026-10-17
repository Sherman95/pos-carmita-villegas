# Arquitectura del POS administrativo

## Implementación

`frontend/` es Angular 21 con Angular Material, RxJS, FullCalendar, Chart.js,
jsPDF/XLSX y componentes standalone cargados por rutas. Las rutas POS incluyen
ventas, catálogo, clientes, reportes, gastos, caja, citas, profesionales y
configuración. Las rutas añadidas para SIDRO son:

- `/sidro/requests`
- `/sidro/settings`

Ambas sólo usan `authGuard`, no un guard de rol en el frontend; la autorización
real reside en el backend.

## Módulos originales y SIDRO

| Original POS | Añadido SIDRO |
|---|---|
| ventas/carrito, clientes, ítems, caja, reportes, gastos | solicitudes SIDRO |
| empleados/profesionales y citas | configuración de servicios reservables |
| perfil, configuración y autenticación POS | horarios, vinculación de cuentas y propuestas |

La integración intenta ser aditiva: usa tablas `sidro_*`, endpoints bajo
`/api/sidro` y `/api/admin/sidro`, y conserva los endpoints POS existentes.
No obstante, la creación SIDRO finalmente escribe en `appointments`, por lo que
un error transaccional sí puede afectar la agenda compartida.

## Incompatibilidad frontend observada

`frontend/src/app/services/sidro-admin.service.ts` construye
`${apiBaseUrl}/admin/sidro`, pero el backend monta `/api/admin/sidro`. En los
entornos actuales esto produce llamadas a una ruta distinta a la implementada.
Es un defecto de integración confirmado por lectura estática.

## No verificado

No se pudo determinar si existe una PWA SIDRO separada ni si el POS desplegado
coincide con este árbol. El `README.md` del frontend sólo documenta Angular CLI y
no describe SIDRO.
