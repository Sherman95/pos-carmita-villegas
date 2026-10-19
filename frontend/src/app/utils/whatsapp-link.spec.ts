import { describe, expect, it } from 'vitest';
import {
  buildWhatsappLink,
  buildWhatsappTemplateMessage,
  whatsappMessageTemplates
} from './whatsapp-link';

describe('whatsapp-link', () => {
  it('construye un enlace wa.me con el número en dígitos', () => {
    const link = buildWhatsappLink('+593991234567', 'Hola');
    expect(link).toBe('https://wa.me/593991234567?text=Hola');
  });

  it('elimina separadores del número antes de armar el enlace', () => {
    const link = buildWhatsappLink('099-123-4567', 'Consulta');
    expect(link).toBe(`https://wa.me/0991234567?text=${encodeURIComponent('Consulta')}`);
  });

  it('codifica el mensaje para que abra el destino correcto', () => {
    const message = 'Hola, ¿cómo estás? Reserva #12 & más';
    const link = buildWhatsappLink('+593991234567', message);
    expect(link).toBe(`https://wa.me/593991234567?text=${encodeURIComponent(message)}`);
    expect(link?.split('?text=')[1]).not.toContain(' ');
  });

  it('rechaza números demasiado cortos o largos', () => {
    expect(buildWhatsappLink('12345', 'Hola')).toBeNull();
    expect(buildWhatsappLink('12345678901234567890', 'Hola')).toBeNull();
    expect(buildWhatsappLink(null, 'Hola')).toBeNull();
    expect(buildWhatsappLink('', 'Hola')).toBeNull();
  });

  it('las plantillas generan mensajes con el contexto de la solicitud', () => {
    const context = {
      clientName: 'Ana',
      serviceName: 'Coloración',
      date: '20 oct 2026',
      time: '09:00'
    };
    const message = buildWhatsappTemplateMessage('confirm', context);
    expect(message).toContain('Ana');
    expect(message).toContain('Coloración');
    expect(message).toContain('20 oct 2026');
    expect(whatsappMessageTemplates.length).toBeGreaterThanOrEqual(4);
  });
});
