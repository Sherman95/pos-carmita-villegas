import pool from './db';

export async function initSidroCompleteRegistration85() {
  await pool.query(`ALTER TABLE sidro_client_accounts ADD COLUMN IF NOT EXISTS documento VARCHAR(13)`);
  await pool.query(`ALTER TABLE sidro_client_accounts ADD COLUMN IF NOT EXISTS direccion TEXT`);
  await pool.query(`ALTER TABLE sidro_client_accounts ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ`);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'sidro_client_accounts_documento_check'
      ) THEN
        ALTER TABLE sidro_client_accounts
          ADD CONSTRAINT sidro_client_accounts_documento_check
          CHECK (documento IS NULL OR documento ~ '^[0-9]{10}$' OR documento ~ '^[0-9]{13}$');
      END IF;
    END $$;
  `);
  await pool.query(`
    DO $$
    DECLARE
      duplicate_count INTEGER;
    BEGIN
      SELECT COUNT(*) INTO duplicate_count FROM (
        SELECT documento
        FROM sidro_client_accounts
        WHERE documento IS NOT NULL
        GROUP BY documento
        HAVING COUNT(*) > 1
      ) duplicates;

      IF duplicate_count = 0 THEN
        CREATE UNIQUE INDEX IF NOT EXISTS sidro_client_accounts_documento_unique_idx
          ON sidro_client_accounts (documento)
          WHERE documento IS NOT NULL;
        RAISE NOTICE 'Fase 8.5A: indice unico de documento asegurado';
      ELSE
        RAISE WARNING 'Fase 8.5A: % documentos duplicados detectados; indice unico no creado, revisar cuentas manualmente', duplicate_count;
      END IF;
    END $$;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS sidro_client_accounts_telefono_digits_idx
      ON sidro_client_accounts (regexp_replace(telefono, '\\D', '', 'g'))
  `);
  await pool.query(`
    DO $$
    DECLARE
      existing_definition TEXT;
    BEGIN
      SELECT pg_get_constraintdef(oid) INTO existing_definition
      FROM pg_constraint
      WHERE conname = 'sidro_client_accounts_email_verification_pair_check';

      IF existing_definition IS NULL
         OR existing_definition NOT LIKE '%(email_verification_token_hash IS NULL) = (email_verification_expires_at IS NULL)%' THEN
        IF existing_definition IS NOT NULL THEN
          ALTER TABLE sidro_client_accounts DROP CONSTRAINT sidro_client_accounts_email_verification_pair_check;
        END IF;
        ALTER TABLE sidro_client_accounts
          ADD CONSTRAINT sidro_client_accounts_email_verification_pair_check CHECK (
            ((email_verification_token_hash IS NULL) = (email_verification_expires_at IS NULL))
            AND (pending_email IS NULL OR email_verification_token_hash IS NOT NULL)
          );
        RAISE NOTICE 'Fase 8.5A: restriccion de verificacion de correo actualizada para el token de registro inicial';
      END IF;
    END $$;
  `);
}

export interface SidroCompleteRegistration85Report {
  ok: boolean;
  missing_columns: string[];
  wrong_column_types: string[];
  documento_check_ok: boolean;
  documento_unique_index_ok: boolean;
  telefono_index_ok: boolean;
  email_verification_constraint_ok: boolean;
}

const EXPECTED_COLUMNS: Array<{ name: string; type: string }> = [
  { name: 'documento', type: 'character varying' },
  { name: 'direccion', type: 'text' },
  { name: 'privacy_accepted_at', type: 'timestamp with time zone' }
];

export async function verifySidroCompleteRegistration85(): Promise<SidroCompleteRegistration85Report> {
  const columns = (await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'sidro_client_accounts'`
  )).rows as Array<{ column_name: string; data_type: string }>;
  const missing_columns: string[] = [];
  const wrong_column_types: string[] = [];
  for (const expected of EXPECTED_COLUMNS) {
    const found = columns.find((column) => column.column_name === expected.name);
    if (!found) missing_columns.push(expected.name);
    else if (found.data_type !== expected.type) wrong_column_types.push(expected.name);
  }
  const documento_check_ok = (await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'sidro_client_accounts_documento_check'`
  )).rows.length > 0;
  const documento_unique_index_ok = (await pool.query(
    `SELECT 1 FROM pg_indexes WHERE tablename = 'sidro_client_accounts' AND indexname = 'sidro_client_accounts_documento_unique_idx'`
  )).rows.length > 0;
  const telefono_index_ok = (await pool.query(
    `SELECT 1 FROM pg_indexes WHERE tablename = 'sidro_client_accounts' AND indexname = 'sidro_client_accounts_telefono_digits_idx'`
  )).rows.length > 0;
  const emailVerificationDefinition = (await pool.query(
    `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'sidro_client_accounts_email_verification_pair_check'`
  )).rows[0]?.definition as string | undefined;
  const email_verification_constraint_ok =
    typeof emailVerificationDefinition === 'string' &&
    emailVerificationDefinition.includes('(email_verification_token_hash IS NULL) = (email_verification_expires_at IS NULL)');
  return {
    ok:
      missing_columns.length === 0 &&
      wrong_column_types.length === 0 &&
      documento_check_ok &&
      documento_unique_index_ok &&
      telefono_index_ok &&
      email_verification_constraint_ok,
    missing_columns,
    wrong_column_types,
    documento_check_ok,
    documento_unique_index_ok,
    telefono_index_ok,
    email_verification_constraint_ok
  };
}
