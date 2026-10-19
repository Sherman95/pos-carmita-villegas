import { Pool, PoolClient } from 'pg';
import pool from '../database/db';
import { FinancialError, requireOpenRegister } from './financialIntegrity.service';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export const CASH_CONTROL_CONFIG_KEY = 'cash_control_enabled';
export const CASH_CONTROL_LOCK_KEY = 'cash_control_mode_phase7';

const parseStoredBoolean = (value: unknown): boolean =>
  String(value ?? 'true').trim().toLowerCase() !== 'false';

export const getCashControlEnabled = async (db: Queryable = pool): Promise<boolean> => {
  const result = await db.query(
    'SELECT config_value FROM business_config WHERE config_key = $1 LIMIT 1',
    [CASH_CONTROL_CONFIG_KEY]
  );
  return parseStoredBoolean(result.rows[0]?.config_value);
};

export const lockCashControlShared = async (client: PoolClient): Promise<void> => {
  await client.query('SELECT pg_advisory_xact_lock_shared(hashtext($1))', [CASH_CONTROL_LOCK_KEY]);
};

export const lockCashControlExclusive = async (client: PoolClient): Promise<void> => {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [CASH_CONTROL_LOCK_KEY]);
};

export const enforceCashPolicyForFinancialOperation = async (client: PoolClient): Promise<boolean> => {
  await lockCashControlShared(client);
  const enabled = await getCashControlEnabled(client);
  if (enabled) await requireOpenRegister(client);
  return enabled;
};

export const requireCashControlEnabled = async (client: PoolClient): Promise<void> => {
  await lockCashControlShared(client);
  if (!await getCashControlEnabled(client)) {
    throw new FinancialError(409, 'El control de caja está desactivado. Actívalo desde Configuración antes de abrir o cerrar una sesión.');
  }
};

