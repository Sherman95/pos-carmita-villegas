import { Request, Response } from 'express';
import pool from '../database/db';
import { AdminAuditService } from '../services/adminAudit.service';
import {
  CASH_CONTROL_CONFIG_KEY,
  getCashControlEnabled,
  lockCashControlExclusive
} from '../services/cashControl.service';
import { FinancialError } from '../services/financialIntegrity.service';
import {
  WHATSAPP_CONTACT_DEFAULT_MESSAGE,
  WHATSAPP_CONTACT_MESSAGE_MAX_LENGTH,
  getWhatsappContactConfig,
  upsertWhatsappContactConfig
} from '../services/whatsappContact.service';
import { normalizeWhatsapp } from '../services/sidroIdentity.service';

const OPEN_REGISTER_ERROR = 'No puedes desactivar el control de caja mientras exista una sesión abierta. Cierra la caja actual para conservar correctamente su historial y movimientos.';

const sendError = (res: Response, error: unknown) => {
  if (error instanceof FinancialError) return res.status(error.status).json({ error: error.message });
  console.error('[CASH CONTROL SETTINGS]', error);
  return res.status(500).json({ error: 'No se pudo actualizar la configuración de caja' });
};

export const getCashControlSetting = async (_req: Request, res: Response) => {
  try {
    return res.json({ controlEnabled: await getCashControlEnabled() });
  } catch (error) {
    return sendError(res, error);
  }
};

export const updateCashControlSetting = async (req: Request, res: Response) => {
  if (typeof req.body?.controlEnabled !== 'boolean') {
    return res.status(400).json({ error: 'controlEnabled debe ser un valor booleano' });
  }

  const client = await pool.connect();
  const nextEnabled = req.body.controlEnabled as boolean;
  let previousEnabled: boolean | null = null;
  try {
    await client.query('BEGIN');
    await lockCashControlExclusive(client);
    previousEnabled = await getCashControlEnabled(client);

    if (previousEnabled && !nextEnabled) {
      const open = await client.query(
        `SELECT id, fecha_apertura
         FROM cash_registers
         WHERE estado = 'ABIERTA'
         ORDER BY fecha_apertura DESC
         LIMIT 1
         FOR SHARE`
      );
      if (open.rows[0]) throw new FinancialError(409, OPEN_REGISTER_ERROR);
    }

    if (previousEnabled !== nextEnabled) {
      await client.query(
        `INSERT INTO business_config(config_key, config_value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (config_key)
         DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()`,
        [CASH_CONTROL_CONFIG_KEY, String(nextEnabled)]
      );
      await AdminAuditService.record(
        'CASH_CONTROL_SETTINGS_UPDATED',
        req.userId || null,
        null,
        { previous_enabled: previousEnabled, next_enabled: nextEnabled, result: 'updated' },
        client
      );
    }

    await client.query('COMMIT');
    return res.json({
      controlEnabled: nextEnabled,
      changed: previousEnabled !== nextEnabled,
      message: nextEnabled
        ? 'El control de caja está activado. Abre una nueva caja para comenzar a registrar operaciones.'
        : 'El control de caja está desactivado. Puedes operar el POS sin abrir una sesión.'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof FinancialError && error.status === 409) {
      try {
        await AdminAuditService.record(
          'CASH_CONTROL_SETTINGS_UPDATED',
          req.userId || null,
          null,
          { previous_enabled: previousEnabled, next_enabled: nextEnabled, result: 'rejected_open_register' }
        );
      } catch (auditError) {
        console.error('[CASH CONTROL SETTINGS AUDIT]', auditError);
      }
    }
    return sendError(res, error);
  } finally {
    client.release();
  }
};

export const getWhatsappContactSetting = async (_req: Request, res: Response) => {
  try {
    return res.json(await getWhatsappContactConfig());
  } catch (error) {
    console.error('[WHATSAPP CONTACT SETTINGS]', error);
    return res.status(500).json({ error: 'No se pudo consultar la configuración de WhatsApp' });
  }
};

export const updateWhatsappContactSetting = async (req: Request, res: Response) => {
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled debe ser un valor booleano' });
  }

  const rawMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (rawMessage.length > WHATSAPP_CONTACT_MESSAGE_MAX_LENGTH) {
    return res.status(400).json({
      error: `El mensaje no puede superar ${WHATSAPP_CONTACT_MESSAGE_MAX_LENGTH} caracteres`
    });
  }

  const rawWhatsapp = typeof req.body?.whatsapp === 'string' ? req.body.whatsapp.trim() : '';
  const normalized = rawWhatsapp ? normalizeWhatsapp(rawWhatsapp) : null;
  if (rawWhatsapp && !normalized) {
    return res.status(400).json({ error: 'Ingresa un número de WhatsApp válido, por ejemplo +593991234567' });
  }

  const client = await pool.connect();
  const nextMessage = rawMessage || WHATSAPP_CONTACT_DEFAULT_MESSAGE;
  try {
    await client.query('BEGIN');
    await upsertWhatsappContactConfig(client, {
      whatsapp: normalized,
      enabled: req.body.enabled,
      message: nextMessage
    });
    await AdminAuditService.record(
      'WHATSAPP_CONTACT_SETTINGS_UPDATED',
      req.userId || null,
      null,
      {
        enabled: req.body.enabled,
        has_number: Boolean(normalized),
        message_length: nextMessage.length,
        result: 'updated'
      },
      client
    );
    await client.query('COMMIT');
    return res.json(await getWhatsappContactConfig());
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[WHATSAPP CONTACT SETTINGS]', error);
    return res.status(500).json({ error: 'No se pudo actualizar la configuración de WhatsApp' });
  } finally {
    client.release();
  }
};

export const getPublicWhatsappContact = async (_req: Request, res: Response) => {
  try {
    const config = await getWhatsappContactConfig();
    if (!config.active) {
      return res.json({ enabled: false, whatsapp: null, message: null });
    }
    return res.json({ enabled: true, whatsapp: config.whatsapp, message: config.message });
  } catch (error) {
    console.error('[WHATSAPP CONTACT PUBLIC]', error);
    return res.status(500).json({ error: 'No se pudo consultar el contacto de WhatsApp' });
  }
};

