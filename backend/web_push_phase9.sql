-- Fase 9: Web Push como canal adicional de notifications.
-- Migración aditiva, idempotente y sin modificación destructiva de históricos.

BEGIN;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  subscriber_type VARCHAR(16) NOT NULL
    CHECK (subscriber_type IN ('pos_user', 'sidro_account')),
  subscriber_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  token_version INTEGER NOT NULL DEFAULT 0,
  user_agent VARCHAR(512),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disabled_at TIMESTAMPTZ,
  CONSTRAINT push_subscriptions_endpoint_unique UNIQUE (endpoint)
);

ALTER TABLE public.push_subscriptions
  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS push_subscriptions_subscriber_active_idx
  ON public.push_subscriptions (subscriber_type, subscriber_id)
  WHERE disabled_at IS NULL;

CREATE TABLE IF NOT EXISTS public.push_outbox (
  id BIGSERIAL PRIMARY KEY,
  notification_id BIGINT NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  subscription_id BIGINT NOT NULL REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED_RETRY', 'FAILED_PERMANENT', 'SUPERSEDED')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  last_error_code VARCHAR(64),
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT push_outbox_notification_subscription_unique
    UNIQUE (notification_id, subscription_id)
);

CREATE INDEX IF NOT EXISTS push_outbox_claim_idx
  ON public.push_outbox (status, next_attempt_at, id)
  WHERE status IN ('PENDING', 'FAILED_RETRY');

CREATE INDEX IF NOT EXISTS push_outbox_processing_idx
  ON public.push_outbox (locked_at)
  WHERE status = 'PROCESSING';

COMMIT;
