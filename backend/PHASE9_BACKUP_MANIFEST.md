# Manifiesto de respaldo previo a Fase 9

- Fecha: 18 de octubre de 2026.
- Ubicación: `.phase9-backup/pre_changes_20261018/`.
- Base respaldada: `poscarmitaVlocal` en localhost.
- Archivo: `poscarmitaVlocal_pre_phase9.dump`.
- Tamaño: 119818 bytes.
- SHA-256: `EF645BC30ACC1A0F444DAD6A17E12745224D9672A7CD6F92049F0BFDDB3F7224`.
- Alcance: dump de base local y copias de los archivos backend, POS y SIDRO que podían ser afectados por la implementación.

El respaldo no contiene cambios de producción y no debe publicarse en Git. Antes de una restauración, verificar nuevamente el hash y restaurar en una base temporal para inspección; no sobrescribir una base activa directamente.
