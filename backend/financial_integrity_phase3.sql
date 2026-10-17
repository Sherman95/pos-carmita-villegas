-- Fase 3: integridad financiera. Revisar y respaldar antes de ejecutar.
-- Es idempotente y no modifica importes ni cierra cajas existentes.

BEGIN;

ALTER TABLE public.sales
    ADD COLUMN IF NOT EXISTS operation_id uuid;

ALTER TABLE public.payment_history
    ADD COLUMN IF NOT EXISTS operation_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_operation_id
    ON public.sales (operation_id)
    WHERE operation_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_history_operation_id
    ON public.payment_history (operation_id)
    WHERE operation_id IS NOT NULL;

DO $$
BEGIN
    IF (SELECT COUNT(*) FROM public.cash_registers WHERE estado = 'ABIERTA') > 1 THEN
        RAISE EXCEPTION 'Existen varias cajas abiertas; resolver manualmente antes de crear la restriccion';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_register_single_open
    ON public.cash_registers ((1))
    WHERE estado = 'ABIERTA';

COMMIT;
