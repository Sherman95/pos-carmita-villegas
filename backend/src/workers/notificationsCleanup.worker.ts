import { notificationsCleanupEnabled, purgeReadNotifications } from '../services/notificationsCleanup.service';

const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
let timer: NodeJS.Timeout | null = null;

export function startNotificationsCleanupWorker(): NodeJS.Timeout | null {
  if (!notificationsCleanupEnabled()) {
    console.log('[CLEANUP][WORKER] Deshabilitado; define NOTIFICATIONS_CLEANUP_DISABLED=false para activarlo');
    return null;
  }
  if (timer) return timer;
  const run = async () => {
    try {
      const result = await purgeReadNotifications();
      if (result.skipped) {
        console.log('[CLEANUP][WORKER] Omitido: otra instancia está purgando');
        return;
      }
      if (result.deleted > 0 || result.supersededJobs > 0) {
        console.log('[CLEANUP][WORKER] Notificaciones leídas purgadas', {
          deleted: result.deleted,
          supersededJobs: result.supersededJobs,
          batches: result.batches,
          durationMs: result.durationMs
        });
      }
    } catch (error: any) {
      console.error('[CLEANUP][WORKER] Error de limpieza', { code: error?.code || 'UNKNOWN' });
    }
  };
  void run();
  timer = setInterval(() => void run(), CLEANUP_INTERVAL_MS);
  timer.unref?.();
  console.log('[CLEANUP][WORKER] Iniciado (cada 30 minutos)');
  return timer;
}

export function stopNotificationsCleanupWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
