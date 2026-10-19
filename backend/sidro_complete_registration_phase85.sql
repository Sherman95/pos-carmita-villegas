-- Fase 8.5A: registro completo de clientas SIDRO (documento, direccion, consentimiento).
-- Migracion aditiva e idempotente. No modifica datos existentes, credenciales ni vinculos.

ALTER TABLE sidro_client_accounts ADD COLUMN IF NOT EXISTS documento VARCHAR(13);
ALTER TABLE sidro_client_accounts ADD COLUMN IF NOT EXISTS direccion TEXT;
ALTER TABLE sidro_client_accounts ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ;

-- Longitud valida del documento preservado como texto (permite ceros iniciales).
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

-- Detecta colisiones historicas (cuentas antiguas) antes de crear el indice unico.
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

-- Indice de apoyo para busquedas de coincidencias por telefono normalizado.
CREATE INDEX IF NOT EXISTS sidro_client_accounts_telefono_digits_idx
  ON sidro_client_accounts (regexp_replace(telefono, '\D', '', 'g'));

-- Registro con correo pendiente de verificacion: el token inicial existe sin pending_email.
-- La restriccion de Fase 4 exigia pending_email junto al par token/expiración; se reemplaza por una
-- version estrictamente mas permisiva que conserva las salvaguardas (token y expiración juntos,
-- y pending_email solo con token). No invalida filas existentes.
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
