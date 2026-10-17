# Autenticación y seguridad

## POS

`auth.controller.ts` verifica exclusivamente con bcrypt (`bcrypt.compare`); el
fallback de contraseña en texto plano fue eliminado. El JWT dura 8 horas y
contiene `sub`, `role` y `username`. `JWT_SECRET` es obligatorio (mínimo 32
caracteres); el inicio falla si no cumple.

Las cuentas locales de la base `poscarmitaVlocal` quedaron saneadas (P6.4):
`emp1_test` y `emp2_test` almacenan bcrypt. Esto no implica que las cuentas de
producción estén migradas; su formato real sigue sin verificarse.

## SIDRO

`sidroAuth.controller.ts` usa Argon2 para registrar/verificar cuentas. El JWT dura
7 días y contiene `id`, `role: sidro_client` y `client_id`. El middleware extrae
`sub || id`, asigna `userRole` y acepta dos cabeceras.

## Autorización

Las rutas administrativas exigen rol `admin` o `user`; operaciones sensibles
comprueban administrador o profesional vinculado. El perfil SIDRO exige
`sidro_client`. El frontend sólo tiene `authGuard`, por lo que no reemplaza la
autorización del servidor.

## Riesgos prioritarios

- CORS global sin allowlist.
- Logs de usuario, IDs y errores internos.
- Formatos de contraseña en producción sin verificar: la base local quedó
  íntegramente en bcrypt, pero producción no fue auditada ni migrada.
- Sin validación de formato, rango, pertenencia o transición de estado robusta.
- Credenciales de Google existe como archivo `backend/google-credentials.json`;
  su contenido no se documenta ni se expone. Debe gestionarse fuera del repo y
  auditarse su seguimiento Git.
- `force=true` permite omitir conflictos y está disponible en endpoints protegidos
  sin una comprobación de rol específica visible en el controlador de citas.

No se ejecutaron pruebas de explotación.
