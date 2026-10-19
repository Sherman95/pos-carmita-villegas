BEGIN;

-- Fase 4: identidad SIDRO, verificacion de correo y diagnostico de entregas.
-- Idempotente y compatible con cuentas legacy cuyo email puede ser NULL.
ALTER TABLE public.sidro_client_accounts
  ALTER COLUMN email DROP NOT NULL;

ALTER TABLE public.sidro_client_accounts
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS pending_email varchar(255),
  ADD COLUMN IF NOT EXISTS email_verification_token_hash text,
  ADD COLUMN IF NOT EXISTS email_verification_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_change_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS password_reset_delivery_status varchar(32),
  ADD COLUMN IF NOT EXISTS password_reset_provider_message_id text,
  ADD COLUMN IF NOT EXISTS password_reset_last_error_code varchar(64);

-- Los correos existentes ya eran credenciales activas antes de esta fase.
UPDATE public.sidro_client_accounts
SET email = lower(btrim(email)),
    email_verified_at = COALESCE(email_verified_at, updated_at, created_at, now())
WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sidro_client_accounts_email_lower_idx
  ON public.sidro_client_accounts (lower(email))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sidro_client_accounts_pending_email_lower_idx
  ON public.sidro_client_accounts (lower(pending_email))
  WHERE pending_email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sidro_client_accounts_email_verification_token_hash_idx
  ON public.sidro_client_accounts (email_verification_token_hash)
  WHERE email_verification_token_hash IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sidro_client_accounts_email_verification_pair_check'
  ) THEN
    ALTER TABLE public.sidro_client_accounts
      ADD CONSTRAINT sidro_client_accounts_email_verification_pair_check CHECK (
        (pending_email IS NULL AND email_verification_token_hash IS NULL AND email_verification_expires_at IS NULL)
        OR
        (pending_email IS NOT NULL AND email_verification_token_hash IS NOT NULL AND email_verification_expires_at IS NOT NULL)
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.sidro_security_events (
  id bigserial PRIMARY KEY,
  sidro_account_id uuid REFERENCES public.sidro_client_accounts(id) ON DELETE SET NULL,
  event_type varchar(64) NOT NULL,
  outcome varchar(64) NOT NULL,
  provider_message_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sidro_security_events_account_created
  ON public.sidro_security_events (sidro_account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sidro_security_events_type_created
  ON public.sidro_security_events (event_type, created_at DESC);

ALTER TABLE public.sidro_security_events ENABLE ROW LEVEL SECURITY;

COMMIT;
