export interface WhatsappMessageContext {
  clientName?: string | null;
  serviceName?: string | null;
  date?: string | null;
  time?: string | null;
}

export const buildWhatsappLink = (phone: string | null | undefined, message: string): string | null => {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
};

const DEFAULT_TEMPLATES: Array<{
  id: string;
  label: string;
  build: (context: WhatsappMessageContext) => string;
}> = [
  {
    id: 'confirm',
    label: 'Confirmación de solicitud',
    build: (context) =>
      `Hola ${context.clientName || ''}, te escribimos de Carmita Villegas sobre tu solicitud de ${
        context.serviceName || 'tu servicio'
      } para el ${context.date || 'día acordado'} a las ${context.time || 'hora acordada'}.`
  },
  {
    id: 'propose',
    label: 'Proponer nuevo horario',
    build: (context) =>
      `Hola ${context.clientName || ''}, necesitamos coordinar un nuevo horario para tu solicitud de ${
        context.serviceName || 'tu servicio'
      }. ¿Te queda bien el ${context.date || 'día acordado'} a las ${context.time || 'hora acordada'}?`
  },
  {
    id: 'info',
    label: 'Solicitar más información',
    build: (context) =>
      `Hola ${context.clientName || ''}, para completar tu reserva de ${
        context.serviceName || 'tu servicio'
      } necesitamos un poco más de información. ¿Nos ayudas respondiendo este mensaje?`
  },
  {
    id: 'reschedule',
    label: 'Aviso de modificación',
    build: (context) =>
      `Hola ${context.clientName || ''}, hubo un cambio en tu solicitud de ${
        context.serviceName || 'tu servicio'
      }. Escríbenos para confirmar el nuevo horario.`
  }
];

export const whatsappMessageTemplates = DEFAULT_TEMPLATES;

export const buildWhatsappTemplateMessage = (
  templateId: string,
  context: WhatsappMessageContext
): string => {
  const template = DEFAULT_TEMPLATES.find((item) => item.id === templateId) || DEFAULT_TEMPLATES[0];
  return template.build(context).replace(/\s+/g, ' ').trim();
};
