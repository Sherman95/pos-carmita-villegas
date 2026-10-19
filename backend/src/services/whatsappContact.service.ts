import { Pool, PoolClient } from 'pg';
import pool from '../database/db';
import { normalizeWhatsapp } from './sidroIdentity.service';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export const WHATSAPP_CONTACT_KEYS = {
  number: 'whatsapp_contact_number',
  enabled: 'whatsapp_contact_enabled',
  message: 'whatsapp_contact_message'
} as const;

export const WHATSAPP_CONTACT_DEFAULT_MESSAGE =
  'Hola, quiero consultar sobre una reserva en Carmita Villegas.';
export const WHATSAPP_CONTACT_MESSAGE_MAX_LENGTH = 300;

export interface WhatsappContactConfig {
  whatsapp: string | null;
  enabled: boolean;
  message: string;
  valid: boolean;
  active: boolean;
}

const parseStoredBoolean = (value: unknown, fallback = true): boolean => {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
};

export const getWhatsappContactConfig = async (db: Queryable = pool): Promise<WhatsappContactConfig> => {
  const result = await db.query(
    'SELECT config_key, config_value FROM business_config WHERE config_key = ANY($1::text[])',
    [[WHATSAPP_CONTACT_KEYS.number, WHATSAPP_CONTACT_KEYS.enabled, WHATSAPP_CONTACT_KEYS.message]]
  );

  const stored = new Map<string, string>(
    result.rows.map((row) => [String(row.config_key), String(row.config_value ?? '')])
  );

  const normalized = normalizeWhatsapp(stored.get(WHATSAPP_CONTACT_KEYS.number) ?? '');
  const enabled = parseStoredBoolean(stored.get(WHATSAPP_CONTACT_KEYS.enabled), true);
  const message =
    (stored.get(WHATSAPP_CONTACT_KEYS.message) ?? '').trim() || WHATSAPP_CONTACT_DEFAULT_MESSAGE;

  return {
    whatsapp: normalized,
    enabled,
    message,
    valid: normalized !== null,
    active: enabled && normalized !== null
  };
};

export const upsertWhatsappContactConfig = async (
  client: PoolClient,
  values: { whatsapp: string | null; enabled: boolean; message: string }
): Promise<void> => {
  const entries: Array<[string, string]> = [
    [WHATSAPP_CONTACT_KEYS.number, values.whatsapp ?? ''],
    [WHATSAPP_CONTACT_KEYS.enabled, String(values.enabled)],
    [WHATSAPP_CONTACT_KEYS.message, values.message]
  ];

  for (const [key, value] of entries) {
    await client.query(
      `INSERT INTO business_config(config_key, config_value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (config_key)
       DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()`,
      [key, value]
    );
  }
};
