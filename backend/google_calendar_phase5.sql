BEGIN;

-- Fase 5: outbox por cita y calendario. No depende del tipo UUID/INTEGER de appointments.id.
CREATE TABLE IF NOT EXISTS public.google_calendar_outbox (
  id bigserial PRIMARY KEY,
  appointment_key text NOT NULL,
  google_calendar_id bigint NOT NULL,
  calendar_id_snapshot varchar(255) NOT NULL,
  operation varchar(16) NOT NULL CHECK (operation IN ('UPSERT', 'DELETE')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key varchar(64) NOT NULL UNIQUE,
  status varchar(24) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'FAILED_RETRY', 'FAILED_PERMANENT', 'COMPLETED', 'SUPERSEDED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  last_error_code varchar(64),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_google_calendar_outbox_ready
  ON public.google_calendar_outbox (next_attempt_at, id)
  WHERE status IN ('PENDING', 'FAILED_RETRY');

CREATE INDEX IF NOT EXISTS idx_google_calendar_outbox_destination
  ON public.google_calendar_outbox (appointment_key, google_calendar_id, id DESC);

ALTER TABLE public.google_calendar_outbox ENABLE ROW LEVEL SECURITY;

COMMIT;
