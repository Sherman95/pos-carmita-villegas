interface PasswordResetEmailInput {
  recipientEmail: string;
  recipientName: string;
  resetUrl: string;
}

interface PasswordChangedEmailInput {
  recipientEmail: string;
  recipientName: string;
  loginUrl: string;
}

interface EmailVerificationInput {
  recipientEmail: string;
  recipientName: string;
  verificationUrl: string;
}

interface EmailChangedNoticeInput {
  recipientEmail: string;
  recipientName: string;
  loginUrl: string;
}

interface PosPasswordResetEmailInput {
  recipientEmail: string;
  recipientName: string;
  resetUrl: string;
}

export interface BrevoDeliveryResult {
  accepted: true;
  messageId: string | null;
}

const getConfig = () => {
  const apiKey = process.env.BREVO_API_KEY?.trim() || '';
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim() || '';
  const senderName = process.env.BREVO_SENDER_NAME?.trim() || 'Carmita Villegas Estilistas';

  if (!apiKey || !senderEmail) {
    throw new Error('Brevo no está configurado en el servidor');
  }

  return { apiKey, senderEmail, senderName };
};

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const templateIdFromEnv = (value: string | undefined): number | null => {
  const templateId = Number(value);
  return Number.isInteger(templateId) && templateId > 0 ? templateId : null;
};

const sendTransactionalEmail = async (
  apiKey: string,
  payload: Record<string, unknown>
): Promise<BrevoDeliveryResult> => {
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const responsePayload = await response.json().catch(() => null) as { message?: string; code?: string } | null;
    const error = new Error(responsePayload?.message || `Brevo rechazó el envío (${response.status})`) as Error & { providerCode?: string; status?: number };
    error.providerCode = responsePayload?.code || `HTTP_${response.status}`;
    error.status = response.status;
    throw error;
  }

  const responsePayload = await response.json().catch(() => null) as { messageId?: string } | null;
  return { accepted: true, messageId: responsePayload?.messageId || null };
};

export class BrevoService {
  static isConfigured(): boolean {
    return Boolean(
      process.env.BREVO_API_KEY?.trim() &&
      process.env.BREVO_SENDER_EMAIL?.trim()
    );
  }

  static async sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<BrevoDeliveryResult> {
    const config = getConfig();
    const templateId = templateIdFromEnv(process.env.BREVO_PASSWORD_RESET_TEMPLATE_ID);

    if (templateId) {
      return sendTransactionalEmail(config.apiKey, {
        sender: { name: config.senderName, email: config.senderEmail },
        to: [{ email: input.recipientEmail, name: input.recipientName }],
        templateId,
        params: {
          CLIENT_NAME: input.recipientName,
          RESET_URL: input.resetUrl,
          EXPIRES_MINUTES: 15
        },
        tags: ['sidro', 'password-reset']
      });
    }

    const safeName = escapeHtml(input.recipientName);
    const safeUrl = escapeHtml(input.resetUrl);

    return sendTransactionalEmail(config.apiKey, {
      sender: { name: config.senderName, email: config.senderEmail },
      to: [{ email: input.recipientEmail, name: input.recipientName }],
      subject: 'Restablece tu contraseña de SIDRO',
      htmlContent: `
          <div style="background:#f8f1ee;padding:32px 16px;font-family:Arial,sans-serif;color:#39252d">
            <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #eadbd6;border-radius:22px;overflow:hidden">
              <div style="height:7px;background:#7a1839"></div>
              <div style="padding:34px">
                <p style="margin:0 0 10px;color:#9b4562;font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase">Carmita Villegas Estilistas</p>
                <h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:32px;color:#4a1c2f">Crea una nueva contraseña</h1>
                <p style="margin:0 0 12px;line-height:1.6">Hola ${safeName},</p>
                <p style="margin:0 0 24px;line-height:1.6">Recibimos una solicitud para restablecer la contraseña de tu cuenta SIDRO. Este enlace estará disponible durante 15 minutos.</p>
                <a href="${safeUrl}" style="display:inline-block;background:#7a1839;color:#fff;text-decoration:none;font-weight:700;padding:15px 24px;border-radius:999px">Restablecer contraseña</a>
                <p style="margin:26px 0 0;color:#806b73;font-size:13px;line-height:1.55">Si no solicitaste este cambio, puedes ignorar este mensaje. Tu contraseña continuará siendo la misma.</p>
              </div>
            </div>
          </div>`,
      textContent: `Hola ${input.recipientName}. Restablece tu contraseña de SIDRO dentro de los próximos 15 minutos: ${input.resetUrl}. Si no solicitaste este cambio, ignora este mensaje.`,
      tags: ['sidro', 'password-reset-fallback']
    });
  }

  static async sendPosPasswordResetEmail(input: PosPasswordResetEmailInput): Promise<BrevoDeliveryResult> {
    const config = getConfig();
    const safeName = escapeHtml(input.recipientName);
    const safeUrl = escapeHtml(input.resetUrl);
    return sendTransactionalEmail(config.apiKey, {
      sender: { name: config.senderName, email: config.senderEmail },
      to: [{ email: input.recipientEmail, name: input.recipientName }],
      subject: 'Restablece tu acceso al POS Carmita Villegas',
      htmlContent: `<div style="background:#f8f1ee;padding:32px 16px;font-family:Arial,sans-serif;color:#39252d"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:22px;padding:34px"><h1 style="font-family:Georgia,serif;color:#4a1c2f">Restablece tu acceso al POS</h1><p>Hola ${safeName}, una persona autorizada solicitó restablecer tu contraseña.</p><a href="${safeUrl}" style="display:inline-block;background:#7a1839;color:#fff;text-decoration:none;font-weight:700;padding:15px 24px;border-radius:999px">Crear nueva contraseña</a><p style="color:#806b73;font-size:13px">El enlace vence en 20 minutos y solo puede utilizarse una vez.</p></div></div>`,
      textContent: `Hola ${input.recipientName}. Restablece tu acceso al POS dentro de 20 minutos: ${input.resetUrl}`,
      tags: ['pos', 'password-reset']
    });
  }

  static async sendPasswordChangedEmail(input: PasswordChangedEmailInput): Promise<BrevoDeliveryResult> {
    const config = getConfig();
    const templateId = templateIdFromEnv(process.env.BREVO_PASSWORD_CHANGED_TEMPLATE_ID);

    if (templateId) {
      return sendTransactionalEmail(config.apiKey, {
        sender: { name: config.senderName, email: config.senderEmail },
        to: [{ email: input.recipientEmail, name: input.recipientName }],
        templateId,
        params: {
          CLIENT_NAME: input.recipientName,
          LOGIN_URL: input.loginUrl
        },
        tags: ['sidro', 'password-changed']
      });
    }

    const safeName = escapeHtml(input.recipientName);
    const safeUrl = escapeHtml(input.loginUrl);
    return sendTransactionalEmail(config.apiKey, {
      sender: { name: config.senderName, email: config.senderEmail },
      to: [{ email: input.recipientEmail, name: input.recipientName }],
      subject: 'Tu contraseña de SIDRO fue actualizada',
      htmlContent: `
        <div style="background:#f8f1ee;padding:32px 16px;font-family:Arial,sans-serif;color:#39252d">
          <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #eadbd6;border-radius:22px;overflow:hidden">
            <div style="height:7px;background:#7a1839"></div>
            <div style="padding:34px">
              <p style="margin:0 0 10px;color:#9b4562;font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase">Carmita Villegas Estilistas</p>
              <h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:32px;color:#4a1c2f">Contraseña actualizada</h1>
              <p style="margin:0 0 12px;line-height:1.6">Hola ${safeName},</p>
              <p style="margin:0 0 24px;line-height:1.6">La contraseña de tu cuenta SIDRO fue actualizada correctamente.</p>
              <a href="${safeUrl}" style="display:inline-block;background:#7a1839;color:#fff;text-decoration:none;font-weight:700;padding:15px 24px;border-radius:999px">Iniciar sesión</a>
              <p style="margin:26px 0 0;color:#806b73;font-size:13px;line-height:1.55">Si no realizaste este cambio, comunícate directamente con el salón.</p>
            </div>
          </div>
        </div>`,
      textContent: `Hola ${input.recipientName}. La contraseña de tu cuenta SIDRO fue actualizada correctamente. Inicia sesión en ${input.loginUrl}. Si no realizaste este cambio, comunícate con el salón.`,
      tags: ['sidro', 'password-changed-fallback']
    });
  }

  static async sendEmailVerificationEmail(input: EmailVerificationInput): Promise<BrevoDeliveryResult> {
    const config = getConfig();
    const safeName = escapeHtml(input.recipientName);
    const safeUrl = escapeHtml(input.verificationUrl);
    return sendTransactionalEmail(config.apiKey, {
      sender: { name: config.senderName, email: config.senderEmail },
      to: [{ email: input.recipientEmail, name: input.recipientName }],
      subject: 'Confirma tu correo de SIDRO',
      htmlContent: `<div style="background:#f8f1ee;padding:32px 16px;font-family:Arial,sans-serif;color:#39252d"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:22px;padding:34px"><h1 style="font-family:Georgia,serif;color:#4a1c2f">Confirma tu correo</h1><p>Hola ${safeName}, confirma esta dirección para usarla como acceso principal a SIDRO.</p><a href="${safeUrl}" style="display:inline-block;background:#7a1839;color:#fff;text-decoration:none;font-weight:700;padding:15px 24px;border-radius:999px">Confirmar correo</a><p style="color:#806b73;font-size:13px">El enlace vence en 30 minutos. Si no lo solicitaste, ignora este mensaje.</p></div></div>`,
      textContent: `Hola ${input.recipientName}. Confirma tu correo de SIDRO dentro de 30 minutos: ${input.verificationUrl}`,
      tags: ['sidro', 'email-verification']
    });
  }

  static async sendEmailChangedNotice(input: EmailChangedNoticeInput): Promise<BrevoDeliveryResult> {
    const config = getConfig();
    return sendTransactionalEmail(config.apiKey, {
      sender: { name: config.senderName, email: config.senderEmail },
      to: [{ email: input.recipientEmail, name: input.recipientName }],
      subject: 'El correo de tu cuenta SIDRO cambió',
      textContent: `Hola ${input.recipientName}. El correo principal de tu cuenta SIDRO fue cambiado. Si no fuiste tú, comunícate con el salón. Acceso: ${input.loginUrl}`,
      tags: ['sidro', 'email-changed-notice']
    });
  }
}
