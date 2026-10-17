# Estado verificable de implementación

| Componente | Estado | Evidencia/limitación |
|---|---|---|
| API Express POS | Implementado en código | `src/index.ts` y rutas |
| API SIDRO cliente | Implementado en código | `sidro.routes.ts` y controladores |
| API administrativa SIDRO | Implementado en código | `adminSidro.routes.ts` |
| Persistencia POS | Estructuralmente documentada | `pos_carmita_esquema_sin_datos.sql`; instancia no verificada |
| Persistencia SIDRO runtime | Estructuralmente documentada | `sidro_*` aparece en el dump consolidado |
| Persistencia SIDRO alternativa | Presente pero no usada por runtime confirmado | `appointment_requests`, `employee_*` aparecen en el mismo dump |
| Cola Google Calendar | Estructuralmente documentada | `google_calendar_sync_queue` aparece en el dump |
| Motor disponibilidad | Implementado | sin garantía de reserva |
| Citas oficiales | Implementado | servicio transaccional |
| Google Calendar | Parcial | worker/cola, creación y patch |
| POS Angular | Implementado | build no ejecutado durante auditoría |
| Integración POS-SIDRO frontend | Incompatible en URL | servicio administrativo |
| PWA SIDRO independiente | No verificable | fuera del árbol accesible |
| PostgreSQL real | No verificable | no se accedió a BD |

El estado Git contiene cambios y archivos no rastreados previos a esta auditoría;
no se atribuyen a esta documentación.
