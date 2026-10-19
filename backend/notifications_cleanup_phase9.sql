-- Fase 9 (retención): índice parcial para purgar notificaciones leídas tras 24 horas.
-- Migración aditiva e idempotente; no modifica datos ni elimina históricos.
BEGIN;

CREATE INDEX IF NOT EXISTS notifications_read_cleanup_idx
  ON public.notifications (read_at)
  WHERE read_at IS NOT NULL;

COMMIT;
