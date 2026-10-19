import webpush from 'web-push';
import pool from '../database/db';
import { webPushConfigured, webPushRequested } from '../services/pushOutbox.service';

const MAX_ATTEMPTS = 5;
const STALE_AFTER_MINUTES = 5;
let timer: NodeJS.Timeout | null = null;
let running = false;

export const pushErrorCode = (error: any): string =>
  String(error?.statusCode || error?.code || error?.cause?.code || 'UNKNOWN').replace(/[^A-Z0-9_-]/gi, '_').slice(0, 64);

export const isInvalidSubscriptionError = (error: any): boolean => ['404', '410'].includes(pushErrorCode(error));

export const isTransientPushError = (error: any): boolean => {
  const code = pushErrorCode(error).toUpperCase();
  return ['408', '429', '500', '502', '503', '504', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code);
};

export const pushRetryDelaySeconds = (attempts: number): number => Math.min(1800, 30 * (2 ** Math.max(0, attempts - 1)));

export const safePushUrl = (recipientType: string, raw: unknown): string => {
  const value = typeof raw === 'string' ? raw : '';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return recipientType === 'pos_user' ? '/citas/solicitudes' : '/my-requests';
  const allowed = recipientType === 'pos_user' ? '/citas/solicitudes' : '/my-requests';
  return value.startsWith(allowed) ? value : allowed;
};

type PushCopy = { title: string; body: string };

const PUSH_COPY_BY_TYPE: Record<string, PushCopy> = {
  sidro_request_created: {
    title: 'Nueva solicitud de cita',
    body: 'Tienes una nueva solicitud de reserva por revisar. Abre el POS para consultar el servicio y el horario.'
  },
  sidro_request_confirmed: {
    title: 'Tu cita fue confirmada',
    body: '¡Tu cita ha sido confirmada! Consulta los detalles en SIDRO: fecha, la hora y la profesional.'
  },
  sidro_request_approved: {
    title: 'Tu solicitud fue aprobada',
    body: 'Tu solicitud fue aprobada y está completando su proceso de confirmación. Te avisaremos cuando tu cita quede agendada.'
  },
  sidro_request_needs_link: {
    title: 'Solicitud pendiente de vinculación',
    body: 'Una reserva aprobada necesita revisión administrativa para poder incorporarse a la agenda.'
  },
  sidro_request_rejected: {
    title: 'Tu solicitud fue revisada',
    body: 'Hay una actualización importante sobre tu solicitud. Abre SIDRO para revisar el detalle.'
  },
  sidro_request_proposal: {
    title: 'Tienes un nuevo horario propuesto',
    body: 'El salón propuso otro horario para tu reserva. Entra a SIDRO para aceptarlo o rechazarlo.'
  },
  sidro_proposal_accepted: {
    title: 'Horario propuesto aceptado',
    body: 'La propuesta de horario ha sido aceptada. Abre el POS para revisar la solicitud.'
  },
  sidro_proposal_rejected: {
    title: 'Horario propuesto rechazado',
    body: 'La propuesta de horario ha sido rechazada. Abre el POS para revisar la solicitud.'
  },
  sidro_request_link_conflict: {
    title: 'Solicitud con conflicto de agenda',
    body: 'Una reserva necesita revisión administrativa porque no pudo incorporarse a la agenda.'
  },
  sidro_appointment_cancelled: {
    title: 'Tu cita fue cancelada',
    body: 'Tu cita ha sido cancelada. Consulta los detalles en SIDRO o solicita otro horario.'
  }
};

export const buildPushCopy = (job: any): PushCopy => {
  const specific = PUSH_COPY_BY_TYPE[String(job?.type || '')];
  if (specific) return specific;
  return job?.recipient_type === 'pos_user'
    ? { title: 'Nueva actualización en SIDRO', body: 'Hay una solicitud o cambio que requiere tu atención.' }
    : { title: 'Actualización de tu cita', body: 'Hay una actualización de tu cita. Toca para verla.' };
};

export const buildPrivatePushPayload = (job: any): string => {
  const url = safePushUrl(job.recipient_type, job.data?.url);
  const copy = buildPushCopy(job);
  return JSON.stringify({
    notification: {
      title: copy.title,
      body: copy.body,
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      tag: `notification-${job.notification_id}`,
      renotify: false,
      data: {
        url,
        notificationId: String(job.notification_id),
        onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url } }
      }
    }
  });
};

async function claim(client: any): Promise<any | null> {
  const result = await client.query(
    `WITH candidate AS (
       SELECT id FROM push_outbox
       WHERE status IN ('PENDING','FAILED_RETRY') AND attempts < $1 AND next_attempt_at <= NOW()
       ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
     )
     UPDATE push_outbox job SET status='PROCESSING',attempts=job.attempts+1,locked_at=NOW(),updated_at=NOW()
     FROM candidate WHERE job.id=candidate.id RETURNING job.*`,
    [MAX_ATTEMPTS]
  );
  return result.rows[0] || null;
}

async function details(client: any, id: unknown): Promise<any | null> {
  const result = await client.query(
    `SELECT job.*, notification.type,notification.recipient_type,notification.recipient_id,notification.data,notification.read_at,
            subscription.endpoint,subscription.p256dh,subscription.auth,subscription.disabled_at,
            CASE
              WHEN subscription.subscriber_type='pos_user' THEN EXISTS(
                SELECT 1 FROM users u WHERE u.id::text=subscription.subscriber_id AND u.active=true
                  AND COALESCE(u.token_version,0)=subscription.token_version)
              WHEN subscription.subscriber_type='sidro_account' THEN EXISTS(
                SELECT 1 FROM sidro_client_accounts a WHERE a.id::text=subscription.subscriber_id AND a.is_active=true
                  AND COALESCE(a.token_version,0)=subscription.token_version)
              ELSE false END AS account_active,
            subscription.subscriber_type,subscription.subscriber_id
     FROM push_outbox job
     JOIN notifications notification ON notification.id=job.notification_id
     JOIN push_subscriptions subscription ON subscription.id=job.subscription_id
     WHERE job.id=$1`,
    [id]
  );
  return result.rows[0] || null;
}

async function mark(client: any, id: unknown, status: string, code: string | null = null, message: string | null = null, delay = 0) {
  await client.query(
    `UPDATE push_outbox SET status=$2::varchar,last_error_code=$3::varchar,last_error=$4::text,
       next_attempt_at=CASE WHEN $5::int>0 THEN NOW()+($5::text||' seconds')::interval ELSE next_attempt_at END,
       sent_at=CASE WHEN $2::varchar='SENT' THEN NOW() ELSE sent_at END,locked_at=NULL,updated_at=NOW()
     WHERE id=$1`,
    [id, status, code, message?.slice(0, 500) || null, delay]
  );
}

type PushSender = (subscription: webpush.PushSubscription, payload: string) => Promise<unknown>;

export async function processWebPushQueue(options: { pool?: any; sender?: PushSender; limit?: number } = {}) {
  if (running && !options.pool) return;
  const db = options.pool || pool;
  if (!options.pool) running = true;
  let client: any;
  try {
    client = await db.connect();
    await client.query(
      `UPDATE push_outbox SET status='FAILED_RETRY',next_attempt_at=NOW(),locked_at=NULL,
       last_error_code='STALE_PROCESSING',updated_at=NOW()
       WHERE status='PROCESSING' AND locked_at < NOW()-($1::text||' minutes')::interval`,
      [STALE_AFTER_MINUTES]
    );
    const sender = options.sender || ((subscription, payload) => webpush.sendNotification(subscription, payload));
    for (let processed = 0; processed < (options.limit ?? 20); processed++) {
      const claimed = await claim(client);
      if (!claimed) break;
      const job = await details(client, claimed.id);
      if (!job || job.disabled_at || !job.account_active || job.read_at
        || job.subscriber_type !== job.recipient_type || String(job.subscriber_id) !== String(job.recipient_id)) {
        await mark(client, claimed.id, 'SUPERSEDED');
        continue;
      }
      try {
        await sender({ endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth } }, buildPrivatePushPayload(job));
        await mark(client, claimed.id, 'SENT');
        console.log('[PUSH][WORKER] Entrega completada', { jobId: String(claimed.id) });
      } catch (error: any) {
        const code = pushErrorCode(error);
        if (isInvalidSubscriptionError(error)) {
          await client.query(`UPDATE push_subscriptions SET disabled_at=NOW(),updated_at=NOW() WHERE id=$1`, [claimed.subscription_id]);
          await mark(client, claimed.id, 'FAILED_PERMANENT', code, 'Suscripción inválida o expirada');
        } else {
          const retry = isTransientPushError(error) && Number(claimed.attempts) < MAX_ATTEMPTS;
          await mark(client, claimed.id, retry ? 'FAILED_RETRY' : 'FAILED_PERMANENT', code, error?.message || 'Fallo de entrega Push', retry ? pushRetryDelaySeconds(Number(claimed.attempts)) : 0);
        }
        console.error('[PUSH][WORKER] Fallo de entrega', { jobId: String(claimed.id), code });
      }
    }
  } catch (error: any) {
    console.error('[PUSH][WORKER] Error general', { code: pushErrorCode(error) });
  } finally {
    client?.release?.();
    if (!options.pool) running = false;
  }
}

export function startWebPushWorker() {
  if (!webPushRequested()) {
    console.log('[PUSH][WORKER] Deshabilitado; define WEB_PUSH_ENABLED=true para activarlo');
    return null;
  }
  if (!webPushConfigured()) {
    console.warn('[PUSH][WORKER] Deshabilitado: configuración VAPID incompleta');
    return null;
  }
  if (timer) return timer;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  void processWebPushQueue();
  timer = setInterval(() => void processWebPushQueue(), 30000);
  timer.unref?.();
  console.log('[PUSH][WORKER] Iniciado (cada 30s)');
  return timer;
}

export function stopWebPushWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
