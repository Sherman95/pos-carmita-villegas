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
): Promise<void> => {
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
    const responsePayload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(responsePayload?.message || `Brevo rechazó el envío (${response.status})`);
  }
};

export class BrevoService {
  static isConfigured(): boolean {
    return Boolean(
      process.env.BREVO_API_KEY?.trim() &&
      process.env.BREVO_SENDER_EMAIL?.trim()
    );
  }

  static async sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<void> {
    const config = getConfig();
    const templateId = templateIdFromEnv(process.env.BREVO_PASSWORD_RESET_TEMPLATE_ID);

    if (templateId) {
      await sendTransactionalEmail(config.apiKey, {
        to: [{ email: input.recipientEmail, name: input.recipientName }],
        templateId,
        params: {
          CLIENT_NAME: input.recipientName,
          RESET_URL: input.resetUrl,
          EXPIRES_MINUTES: 15
        },
        tags: ['sidro', 'password-reset']
      });
      return;
    }

    const safeName = escapeHtml(input.recipientName);
    const safeUrl = escapeHtml(input.resetUrl);

    await sendTransactionalEmail(config.apiKey, {
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

  static async sendPasswordChangedEmail(input: PasswordChangedEmailInput): Promise<void> {
    const config = getConfig();
    const templateId = templateIdFromEnv(process.env.BREVO_PASSWORD_CHANGED_TEMPLATE_ID);

    if (templateId) {
      await sendTransactionalEmail(config.apiKey, {
        to: [{ email: input.recipientEmail, name: input.recipientName }],
        templateId,
        params: {
          CLIENT_NAME: input.recipientName,
          LOGIN_URL: input.loginUrl
        },
        tags: ['sidro', 'password-changed']
      });
      return;
    }

    const safeName = escapeHtml(input.recipientName);
    const safeUrl = escapeHtml(input.loginUrl);
    await sendTransactionalEmail(config.apiKey, {
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
}
