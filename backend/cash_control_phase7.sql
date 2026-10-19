-- Fase 7: control de caja opcional.
-- Migración aditiva e idempotente. No cierra cajas ni modifica movimientos.

BEGIN;

ALTER TABLE public.sales
    ADD COLUMN IF NOT EXISTS usuario_id uuid;

ALTER TABLE public.payment_history
    ADD COLUMN IF NOT EXISTS usuario_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_sales_usuario_phase7'
          AND conrelid = 'public.sales'::regclass
    ) THEN
        ALTER TABLE public.sales
            ADD CONSTRAINT fk_sales_usuario_phase7
            FOREIGN KEY (usuario_id) REFERENCES public.users(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_payment_history_usuario_phase7'
          AND conrelid = 'public.payment_history'::regclass
    ) THEN
        ALTER TABLE public.payment_history
            ADD CONSTRAINT fk_payment_history_usuario_phase7
            FOREIGN KEY (usuario_id) REFERENCES public.users(id) ON DELETE SET NULL;
    END IF;
END $$;

INSERT INTO public.business_config (config_key, config_value, updated_at)
VALUES ('cash_control_enabled', 'true', NOW())
ON CONFLICT (config_key) DO NOTHING;

COMMIT;

