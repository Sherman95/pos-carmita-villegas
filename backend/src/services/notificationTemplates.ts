import { NotificationInput } from './notifications.service';
import { normalizeDateOnly } from '../utils/businessTime';

export interface SidroRequestNotificationContext {
  requestId: number | string;
  clientName: string;
  serviceName: string;
  date: string | Date | null | undefined;
  time: string | null | undefined;
  proposedDate?: string | null;
  proposedTime?: string | null;
}

export const formatNotificationDate = (value: string | Date | null | undefined): string => {
  let normalized = '';
  try {
    normalized = normalizeDateOnly(value);
  } catch {
    normalized = '';
  }
  const [year, month, day] = normalized.split('-');
  if (!year || !month || !day) return 'fecha por confirmar';
  return `${day}/${month}/${year}`;
};

export const formatNotificationTime = (value: string | null | undefined): string =>
  String(value ?? '').slice(0, 5) || 'hora por confirmar';

const posRequestsUrl = (requestId: number | string): string =>
  `/citas/solicitudes?open=${encodeURIComponent(String(requestId))}`;

const sidroRequestsUrl = (requestId: number | string): string =>
  `/my-requests?open=${encodeURIComponent(String(requestId))}`;

export const SidroNotificationTemplates = {
  requestCreated: (ctx: SidroRequestNotificationContext): NotificationInput => ({
    type: 'sidro_request_created',
    title: 'Nueva solicitud SIDRO',
    body: `${ctx.clientName} solicitó ${ctx.serviceName} para el ${formatNotificationDate(
      ctx.date
    )} a las ${formatNotificationTime(ctx.time)}.`,
    data: { url: posRequestsUrl(ctx.requestId), request_id: ctx.requestId },
    dedupeKey: `req:${ctx.requestId}:created`
  }),

  requestConfirmed: (ctx: SidroRequestNotificationContext): NotificationInput => ({
    type: 'sidro_request_confirmed',
    title: 'Tu cita fue confirmada',
    body: formatNotificationDate(ctx.date) === 'fecha por confirmar'
      ? `Tu solicitud de ${ctx.serviceName} quedó confirmada a las ${formatNotificationTime(ctx.time)}. Revisa el detalle de tu cita.`
      : `Tu solicitud de ${ctx.serviceName} quedó confirmada para el ${formatNotificationDate(ctx.date)} a las ${formatNotificationTime(ctx.time)}.`,
    data: { url: sidroRequestsUrl(ctx.requestId), request_id: ctx.requestId },
    dedupeKey: `req:${ctx.requestId}:status:CONFIRMADA`
  }),

  requestApprovedPendingLink: (ctx: SidroRequestNotificationContext): NotificationInput => ({
    type: 'sidro_request_approved',
    title: 'Tu solicitud fue aprobada',
    body: `Tu solicitud de ${ctx.serviceName} para el ${formatNotificationDate(
      ctx.date
    )} a las ${formatNotificationTime(
      ctx.time
    )} fue aprobada. Estamos terminando de vincular tu expediente para confirmarla.`,
    data: { url: sidroRequestsUrl(ctx.requestId), request_id: ctx.requestId },
    dedupeKey: `req:${ctx.requestId}:status:APROBADA_PENDIENTE_VINCULACION`
  }),

  requestApprovedPendingLinkStaff: (ctx: SidroRequestNotificationContext): NotificationInput => ({
    type: 'sidro_request_needs_link',
    title: 'Aprobada, falta vincular',
    body: `La solicitud de ${ctx.clientName} (${ctx.serviceName}) está aprobada y espera la vinculación de la clienta.`,
    data: { url: posRequestsUrl(ctx.requestId), request_id: ctx.requestId },
    dedupeKey: `req:${ctx.requestId}:status:APROBADA_PENDIENTE_VINCULACION`
  }),

  requestRejected: (ctx: SidroRequestNotificationContext): NotificationInput => ({
    type: 'sidro_request_rejected',
    title: 'Tu solicitud fue revisada',
    body: `Tu solicitud de ${ctx.serviceName} para el ${formatNotificationDate(
      ctx.date
    )} a las ${formatNotificationTime(
      ctx.time
    )} no pudo confirmarse. Puedes crear una nueva reserva cuando quieras.`,
    data: { url: sidroRequestsUrl(ctx.requestId), request_id: ctx.requestId },
    dedupeKey: `req:${ctx.requestId}:status:RECHAZADA`
  }),

  proposalSent: (ctx: SidroRequestNotificationContext): NotificationInput => ({
    type: 'sidro_request_proposal',
    title: 'Nuevo horario propuesto',
    body: `Te propusimos el ${formatNotificationDate(ctx.proposedDate)} a las ${formatNotificationTime(
      ctx.proposedTime
    )} para tu ${ctx.serviceName}. Responde desde Mis solicitudes.`,
    data: { url: sidroRequestsUrl(ctx.requestId), request_id: ctx.requestId },
    dedupeKey: `req:${ctx.requestId}:status:PROPUESTA:${String(ctx.proposedDate ?? '').slice(0, 10)}:${String(
      ctx.proposedTime ?? ''
    ).slice(0, 5)}`
  }),

  proposalAccepted: (ctx: SidroRequestNotificationContext): NotificationInput => ({
    type: 'sidro_proposal_accepted',
    title: 'La clienta aceptó la propuesta',
    body: `${ctx.clientName} aceptó el horario propuesto para ${ctx.serviceName}.`,
    data: { url: posRequestsUrl(ctx.requestId), request_id: ctx.requestId },
    dedupeKey: `req:${ctx.requestId}:proposal-accepted`
  }),

  proposalRejected: (ctx: SidroRequestNotificationContext): NotificationInput => ({
    type: 'sidro_proposal_rejected',
    title: 'La clienta rechazó la propuesta',
    body: `${ctx.clientName} rechazó el horario propuesto; la solicitud quedó cancelada.`,
    data: { url: posRequestsUrl(ctx.requestId), request_id: ctx.requestId },
    dedupeKey: `req:${ctx.requestId}:proposal-rejected`
  }),

  linkConflict: (ctx: SidroRequestNotificationContext): NotificationInput => ({
    type: 'sidro_request_link_conflict',
    title: 'Conflicto de vinculación',
    body: `No se pudo agendar la solicitud de ${ctx.clientName} (${ctx.serviceName}) al vincular: revisa la agenda.`,
    data: { url: posRequestsUrl(ctx.requestId), request_id: ctx.requestId },
    dedupeKey: `req:${ctx.requestId}:status:CONFLICTO_VINCULACION`
  }),

  appointmentCancelled: (ctx: SidroRequestNotificationContext): NotificationInput => ({
    type: 'sidro_appointment_cancelled',
    title: 'Tu cita fue cancelada',
    body: `La cita de ${ctx.serviceName} del ${formatNotificationDate(
      ctx.date
    )} a las ${formatNotificationTime(ctx.time)} fue cancelada. Escríbenos para reprogramar.`,
    data: { url: sidroRequestsUrl(ctx.requestId), request_id: ctx.requestId },
    dedupeKey: `req:${ctx.requestId}:status:CANCELADA`
  })
};
