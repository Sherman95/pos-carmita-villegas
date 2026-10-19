# Fase 9 — Web Push: despliegue, validación y rollback

Estado: implementado y validado únicamente en local el 18 de octubre de 2026. Este documento no autoriza ni ejecuta cambios en producción.

## Arquitectura

- `notifications` (Fase 8) continúa siendo la fuente de verdad.
- `NotificationsService.insertForRecipient` inserta la notificación interna y, solo cuando la inserción fue nueva, crea los trabajos Push en la misma transacción.
- `push_subscriptions` conserva uno o más dispositivos por cuenta POS o SIDRO.
- `push_outbox` desacopla la transacción de negocio de la entrega externa. El worker procesa después del `COMMIT`, usa `FOR UPDATE SKIP LOCKED`, reintentos exponenciales y recuperación de trabajos atascados.
- Un `ROLLBACK` elimina también el trabajo no confirmado; nunca se llama al proveedor Push dentro de la transacción de negocio.
- La carga Push contiene texto genérico y un deep-link interno permitido; el detalle continúa en la bandeja autenticada.

## Migraciones

Antes de cualquier despliegue futuro se debe obtener un respaldo verificable de la base destino. Las migraciones históricas, si todavía no existen en ese entorno, se aplican en este orden:

1. `sidro_auth_phase4.sql`
2. `google_calendar_phase5.sql`
3. `rbac_phase6.sql`
4. `cash_control_phase7.sql`
5. `notifications_phase8.sql`
6. `sidro_complete_registration_phase85.sql`
7. `web_push_phase9.sql`

No se deben volver a ejecutar migraciones históricas a ciegas: primero hay que comparar el esquema. Para un entorno que ya tiene Fases 1–8.5A, solo corresponde `web_push_phase9.sql`. Esta migración es aditiva e idempotente; crea `push_subscriptions`, `push_outbox` e índices, sin borrar notificaciones ni datos existentes.

El comando `npm run migrate:web-push:local` está deliberadamente limitado a `poscarmitaVlocal` y localhost. No sirve para producción. En nube, una persona autorizada debe revisar el SQL, respaldar, ejecutar en una ventana controlada y verificar tablas, restricciones e índices.

## Variables de Render

Generar una sola pareja VAPID estable (no regenerarla en cada despliegue):

```powershell
npx web-push generate-vapid-keys
```

Configurar como secretos, sin escribir valores en Git ni en logs:

```text
WEB_PUSH_ENABLED=false
VAPID_PUBLIC_KEY=<clave pública>
VAPID_PRIVATE_KEY=<clave privada>
VAPID_SUBJECT=mailto:<correo operativo válido>
```

Secuencia segura de activación futura:

1. Desplegar base y backend con `WEB_PUSH_ENABLED=false`.
2. Verificar health, login, bandejas y endpoints `/push/config`.
3. Desplegar las PWA POS y SIDRO.
4. Probar la suscripción con cuentas de prueba y navegadores reales.
5. Cambiar `WEB_PUSH_ENABLED=true` y reiniciar el servicio.
6. Vigilar estados y errores de `push_outbox`.

Sin las tres variables VAPID completas el worker permanece deshabilitado y la aplicación continúa operando con notificaciones internas. El worker corre dentro del proceso backend cada 30 segundos. Una instancia es suficiente; varias instancias son seguras por `SKIP LOCKED`, aunque deben compartir la misma base y las mismas claves VAPID.

## Configuración PWA

### POS

- Usa el Service Worker oficial de Angular (`ngsw-worker.js`) solo en producción.
- Incluye `manifest.webmanifest` e iconos 192/512.
- `ngsw-config.json` no declara `dataGroups`; por tanto no cachea respuestas privadas, financieras ni endpoints API.
- Debe publicarse por HTTPS y el hosting debe conservar la navegación SPA y servir `ngsw.json`, manifiesto e iconos.

### SIDRO

- Reutiliza su Service Worker Angular existente; no se registra un segundo worker.
- Mantiene su manifiesto e instalación PWA.
- Debe publicarse por HTTPS y apuntar al backend autorizado por CORS.

En Vercel, después de un despliegue futuro, verificar en DevTools que exista exactamente un Service Worker por aplicación y que el manifiesto cargue sin 404. Una actualización puede requerir cerrar/reabrir la PWA o recargar para que el nuevo worker tome control.

## Validación en dispositivos reales pendiente

No se enviaron Push reales durante esta fase. La prueba final futura debe hacerse con datos ficticios:

- iPhone/iPad: requiere iOS/iPadOS 16.4 o superior, agregar la PWA a pantalla de inicio, abrirla desde el icono y aceptar el permiso desde el botón explícito.
- Android: instalar o abrir la PWA en Chrome, activar desde la interfaz, cerrar la aplicación y generar un evento ficticio.
- Escritorio: probar Chrome/Edge con la pestaña abierta y cerrada.
- En cada plataforma comprobar activación, recepción, clic/deep-link, login intermedio, desactivación, logout, cambio de cuenta y limpieza de endpoints 404/410.
- Confirmar que POS abre `/citas/solicitudes` y SIDRO `/my-requests`, sin exponer nombres, teléfonos ni descripciones en la pantalla bloqueada.

## Monitoreo

Consultar métricas agregadas, sin imprimir endpoints ni claves:

- cantidad por estado `PENDING`, `PROCESSING`, `SENT`, `FAILED_RETRY`, `FAILED_PERMANENT`, `SUPERSEDED`;
- antigüedad del trabajo pendiente más viejo;
- número de suscripciones activas/deshabilitadas;
- códigos 404/410 (limpieza automática) y 429/5xx (reintentos);
- crecimiento anormal del outbox.

Conservar el polling de bandeja de 30 segundos como respaldo funcional. Un fallo Push nunca debe bloquear citas, solicitudes ni notificaciones internas.

## Rollback

Rollback operativo, reversible y preferido:

1. Establecer `WEB_PUSH_ENABLED=false` en Render y reiniciar el backend.
2. Confirmar el mensaje de worker deshabilitado y que no aumenta `SENT`.
3. Mantener `push_subscriptions` y `push_outbox`; no borrarlos durante el incidente.
4. Mantener la bandeja Fase 8 y su polling activos.
5. Si el problema está en una PWA, volver al artefacto frontend anterior. Las tablas adicionales son compatibles y pueden permanecer.

No es necesario revertir el esquema para desactivar el canal. Si alguna vez se decide retirar definitivamente las tablas, debe hacerse en otra migración revisada, con respaldo y después de demostrar que ningún código desplegado las referencia.

## Riesgos conocidos

- Las políticas de iOS exigen instalación en pantalla de inicio y una acción explícita del usuario.
- Permisos denegados deben rehabilitarse desde el navegador o sistema operativo.
- Suspensión de una instancia gratuita de Render puede retrasar el ciclo de 30 segundos.
- Firewalls, ahorro de batería o políticas empresariales pueden impedir recepción aunque la suscripción sea válida.
- Cambiar las claves VAPID invalida en la práctica las suscripciones existentes y exige volver a suscribir dispositivos.
- SIDRO compila con una advertencia de presupuesto inicial: 569.81 kB frente a 512 kB. No bloquea Push, pero debe optimizarse en una fase posterior.

## Comandos de validación local

```powershell
npm run test:web-push-phase9
npm run test:web-push:local
npm run build
```

Resultados de cierre: Fase 9 backend 69/69; regresión backend 333/333; POS 48/48; SIDRO 50/50; smoke `ok=true`, base `poscarmitaVlocal`, `rolledBack=true`, `noRealPush=true`; los tres builds finalizaron correctamente.
