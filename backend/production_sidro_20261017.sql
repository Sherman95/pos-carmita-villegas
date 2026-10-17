-- ============================================================================
-- POS Carmita Villegas + SIDRO
-- Migración de producción para el esquema Supabase recibido el 2026-10-17.
--
-- IMPORTANTE
--   * Diseñada para employees.id INTEGER y appointments.id INTEGER.
--   * No elimina tablas, columnas ni datos existentes.
--   * Toda la migración se ejecuta en una sola transacción.
--   * Si una validación falla, PostgreSQL revierte todos los cambios.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- Evita que dos operadores ejecuten esta migración al mismo tiempo.
SELECT pg_advisory_xact_lock(hashtext('pos-carmita-production-sidro-20261017'));

-- 1. Preflight: confirmar que el esquema base corresponde al recibido.
DO $$
DECLARE
  actual_type text;
BEGIN
  IF to_regclass('public.items') IS NULL
     OR to_regclass('public.employees') IS NULL
     OR to_regclass('public.appointments') IS NULL
     OR to_regclass('public.clients') IS NULL
     OR to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'Faltan tablas base del POS. No se aplicó ninguna modificación.';
  END IF;

  SELECT udt_name INTO actual_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'id';
  IF actual_type <> 'int4' THEN
    RAISE EXCEPTION 'employees.id debe ser INTEGER (int4), pero es %.', actual_type;
  END IF;

  SELECT udt_name INTO actual_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'appointments' AND column_name = 'id';
  IF actual_type <> 'int4' THEN
    RAISE EXCEPTION 'appointments.id debe ser INTEGER (int4), pero es %.', actual_type;
  END IF;

  SELECT udt_name INTO actual_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'id';
  IF actual_type <> 'uuid' THEN
    RAISE EXCEPTION 'items.id debe ser UUID, pero es %.', actual_type;
  END IF;

  SELECT udt_name INTO actual_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'id';
  IF actual_type <> 'uuid' THEN
    RAISE EXCEPTION 'users.id debe ser UUID, pero es %.', actual_type;
  END IF;
END $$;

-- 2. Catálogo compartido POS / SIDRO.
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS duration_minutes integer,
  ADD COLUMN IF NOT EXISTS is_reservable boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS padding_minutes integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sidro_image_url text,
  ADD COLUMN IF NOT EXISTS sidro_image_public_id text;

ALTER TABLE public.items ALTER COLUMN is_reservable SET DEFAULT false;
ALTER TABLE public.items ALTER COLUMN padding_minutes SET DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.items'::regclass
      AND conname = 'items_duration_minutes_positive_check'
  ) THEN
    ALTER TABLE public.items
      ADD CONSTRAINT items_duration_minutes_positive_check
      CHECK (duration_minutes IS NULL OR duration_minutes > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.items'::regclass
      AND conname = 'items_padding_minutes_nonnegative_check'
  ) THEN
    ALTER TABLE public.items
      ADD CONSTRAINT items_padding_minutes_nonnegative_check
      CHECK (padding_minutes IS NULL OR padding_minutes >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_items_sidro_image_public_id
  ON public.items (sidro_image_public_id)
  WHERE sidro_image_public_id IS NOT NULL;

COMMENT ON COLUMN public.items.duration_minutes IS
  'Duración predeterminada del servicio en minutos para agenda y SIDRO.';
COMMENT ON COLUMN public.items.padding_minutes IS
  'Tiempo adicional de preparación o limpieza después del servicio.';
COMMENT ON COLUMN public.items.is_reservable IS
  'Indica si el servicio está habilitado explícitamente para reservas SIDRO.';
COMMENT ON COLUMN public.items.sidro_image_url IS
  'URL HTTPS de Cloudinary mostrada en SIDRO; no contiene datos binarios.';
COMMENT ON COLUMN public.items.sidro_image_public_id IS
  'Identificador Cloudinary utilizado para reemplazar o eliminar la imagen.';

-- 3. Vinculación opcional entre usuarios del POS y profesionales.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS employee_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_employee_id_fkey'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_employee_id_fkey
      FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_employee_id
  ON public.users (employee_id)
  WHERE employee_id IS NOT NULL;

-- 4. Cuentas de clientas SIDRO y recuperación de contraseña por correo.
CREATE TABLE IF NOT EXISTS public.sidro_client_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_completo varchar(255) NOT NULL,
  telefono varchar(20) NOT NULL UNIQUE,
  email varchar(255) NOT NULL,
  password_hash text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  password_reset_token_hash text,
  password_reset_expires_at timestamptz,
  password_reset_requested_at timestamptz,
  token_version integer NOT NULL DEFAULT 0,
  CONSTRAINT sidro_client_accounts_token_version_nonnegative_check
    CHECK (token_version >= 0),
  CONSTRAINT sidro_client_accounts_password_reset_pair_check
    CHECK (
      (password_reset_token_hash IS NULL AND password_reset_expires_at IS NULL)
      OR
      (password_reset_token_hash IS NOT NULL AND password_reset_expires_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS sidro_client_accounts_email_lower_idx
  ON public.sidro_client_accounts (lower(email));

CREATE UNIQUE INDEX IF NOT EXISTS sidro_client_accounts_password_reset_token_hash_idx
  ON public.sidro_client_accounts (password_reset_token_hash)
  WHERE password_reset_token_hash IS NOT NULL;

-- 5. Relación entre cuenta SIDRO y ficha histórica del POS.
CREATE TABLE IF NOT EXISTS public.sidro_account_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sidro_account_id uuid NOT NULL
    REFERENCES public.sidro_client_accounts(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL
    REFERENCES public.clients(id) ON DELETE RESTRICT,
  admin_id uuid NOT NULL
    REFERENCES public.users(id) ON DELETE RESTRICT,
  fecha_vinculacion timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sidro_account_active
  ON public.sidro_account_links (sidro_account_id)
  WHERE is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sidro_client_historical_active
  ON public.sidro_account_links (client_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_sidro_account_links_client
  ON public.sidro_account_links (client_id);

-- 6. Configuración de servicios y profesionales.
CREATE TABLE IF NOT EXISTS public.sidro_service_professionals (
  id serial PRIMARY KEY,
  service_id uuid NOT NULL
    REFERENCES public.items(id) ON DELETE CASCADE,
  employee_id integer NOT NULL
    REFERENCES public.employees(id) ON DELETE CASCADE,
  specific_duration_minutes integer,
  CONSTRAINT sidro_service_professionals_duration_positive_check
    CHECK (specific_duration_minutes IS NULL OR specific_duration_minutes > 0),
  CONSTRAINT sidro_service_professionals_service_employee_unique
    UNIQUE (service_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_sidro_service_professionals_employee
  ON public.sidro_service_professionals (employee_id);

-- 7. Horarios habituales y bloqueos por profesional.
CREATE TABLE IF NOT EXISTS public.sidro_employee_schedules (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL
    REFERENCES public.employees(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  CONSTRAINT sidro_employee_schedules_valid_time_check
    CHECK (start_time < end_time)
);

CREATE INDEX IF NOT EXISTS idx_sidro_employee_schedules_employee_day
  ON public.sidro_employee_schedules (employee_id, day_of_week);

CREATE OR REPLACE FUNCTION public.check_sidro_schedule_overlap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.sidro_employee_schedules existing_schedule
    WHERE existing_schedule.employee_id = NEW.employee_id
      AND existing_schedule.day_of_week = NEW.day_of_week
      AND existing_schedule.id <> COALESCE(NEW.id, -1)
      AND NEW.start_time < existing_schedule.end_time
      AND NEW.end_time > existing_schedule.start_time
  ) THEN
    RAISE EXCEPTION 'El horario se superpone con un turno existente del profesional.'
      USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_sidro_schedule_overlap
  ON public.sidro_employee_schedules;
CREATE TRIGGER trg_check_sidro_schedule_overlap
BEFORE INSERT OR UPDATE ON public.sidro_employee_schedules
FOR EACH ROW EXECUTE FUNCTION public.check_sidro_schedule_overlap();

CREATE TABLE IF NOT EXISTS public.sidro_employee_blocks (
  id serial PRIMARY KEY,
  employee_id integer NOT NULL
    REFERENCES public.employees(id) ON DELETE CASCADE,
  block_date date NOT NULL,
  start_time time,
  end_time time,
  reason varchar(255),
  block_type varchar(50) NOT NULL DEFAULT 'BLOQUEO_MANUAL',
  CONSTRAINT sidro_employee_blocks_time_pair_check
    CHECK (
      (start_time IS NULL AND end_time IS NULL)
      OR
      (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
    )
);

CREATE INDEX IF NOT EXISTS idx_sidro_employee_blocks_employee_date
  ON public.sidro_employee_blocks (employee_id, block_date);

-- 8. Solicitudes de reserva SIDRO.
CREATE TABLE IF NOT EXISTS public.sidro_appointment_requests (
  id serial PRIMARY KEY,
  sidro_account_id uuid NOT NULL
    REFERENCES public.sidro_client_accounts(id) ON DELETE RESTRICT,
  service_id uuid NOT NULL
    REFERENCES public.items(id) ON DELETE RESTRICT,
  employee_id integer NOT NULL
    REFERENCES public.employees(id) ON DELETE RESTRICT,
  request_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  status varchar(50) NOT NULL DEFAULT 'PENDIENTE',
  client_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  official_appointment_id integer
    REFERENCES public.appointments(id) ON DELETE SET NULL,
  proposed_date date,
  proposed_start_time time,
  proposed_end_time time,
  CONSTRAINT sidro_appointment_requests_valid_time_check
    CHECK (start_time < end_time),
  CONSTRAINT sidro_appointment_requests_client_notes_length_check
    CHECK (client_notes IS NULL OR char_length(client_notes) <= 500),
  CONSTRAINT sidro_appointment_requests_proposal_pair_check
    CHECK (
      (proposed_date IS NULL AND proposed_start_time IS NULL AND proposed_end_time IS NULL)
      OR
      (
        proposed_date IS NOT NULL
        AND proposed_start_time IS NOT NULL
        AND proposed_end_time IS NOT NULL
        AND proposed_start_time < proposed_end_time
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_sidro_requests_account_created
  ON public.sidro_appointment_requests (sidro_account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sidro_requests_employee_date
  ON public.sidro_appointment_requests (employee_id, request_date);

CREATE INDEX IF NOT EXISTS idx_sidro_requests_status
  ON public.sidro_appointment_requests (status);

-- 9. Servicios múltiples dentro de una misma solicitud.
CREATE TABLE IF NOT EXISTS public.sidro_appointment_request_services (
  id bigserial PRIMARY KEY,
  request_id integer NOT NULL
    REFERENCES public.sidro_appointment_requests(id) ON DELETE CASCADE,
  service_id uuid NOT NULL
    REFERENCES public.items(id) ON DELETE RESTRICT,
  position smallint NOT NULL,
  duration_minutes integer NOT NULL,
  padding_minutes integer NOT NULL DEFAULT 0,
  official_appointment_id integer
    REFERENCES public.appointments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sidro_request_services_position_positive_check CHECK (position > 0),
  CONSTRAINT sidro_request_services_duration_positive_check CHECK (duration_minutes > 0),
  CONSTRAINT sidro_request_services_padding_nonnegative_check CHECK (padding_minutes >= 0),
  CONSTRAINT sidro_request_services_request_service_unique UNIQUE (request_id, service_id),
  CONSTRAINT sidro_request_services_request_position_unique UNIQUE (request_id, position)
);

CREATE INDEX IF NOT EXISTS idx_sidro_request_services_request
  ON public.sidro_appointment_request_services (request_id, position);

CREATE INDEX IF NOT EXISTS idx_sidro_request_services_service
  ON public.sidro_appointment_request_services (service_id);

-- Compatibilidad si la tabla de solicitudes ya existiera con registros simples.
INSERT INTO public.sidro_appointment_request_services (
  request_id,
  service_id,
  position,
  duration_minutes,
  padding_minutes,
  official_appointment_id
)
SELECT request.id,
       request.service_id,
       1,
       GREATEST(
         1,
         ROUND(EXTRACT(EPOCH FROM (request.end_time - request.start_time)) / 60)::integer
           - COALESCE(item.padding_minutes, 0)
       ),
       COALESCE(item.padding_minutes, 0),
       request.official_appointment_id
FROM public.sidro_appointment_requests request
JOIN public.items item ON item.id = request.service_id
ON CONFLICT (request_id, service_id) DO NOTHING;

-- 10. Cola local para sincronización de citas con calendarios configurados.
CREATE TABLE IF NOT EXISTS public.google_calendar_sync_queue (
  id serial PRIMARY KEY,
  appointment_id integer NOT NULL
    REFERENCES public.appointments(id) ON DELETE CASCADE,
  employee_id integer NOT NULL
    REFERENCES public.employees(id) ON DELETE RESTRICT,
  status varchar(50) NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_calendar_sync_queue_status_check
    CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  CONSTRAINT google_calendar_sync_queue_attempts_nonnegative_check
    CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS idx_google_calendar_sync_queue_pending
  ON public.google_calendar_sync_queue (status, created_at);

-- El worker usa ON CONFLICT para impedir eventos repetidos.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.appointment_google_events
    GROUP BY appointment_id, google_calendar_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay eventos de calendario duplicados. La migración se detuvo sin cambios.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_appointment_google_events_appointment_calendar
  ON public.appointment_google_events (appointment_id, google_calendar_id);

-- 11. Categorías de gastos usadas por el frontend administrativo.
CREATE TABLE IF NOT EXISTS public.expense_categories (
  id serial PRIMARY KEY,
  nombre varchar(100) NOT NULL,
  codigo varchar(50) NOT NULL UNIQUE,
  descripcion text,
  tipo varchar(20) NOT NULL DEFAULT 'LOCAL',
  icono varchar(50) NOT NULL DEFAULT 'category',
  color varchar(30) NOT NULL DEFAULT 'blue',
  es_sistema boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.expense_categories
  (nombre, codigo, descripcion, tipo, icono, color, es_sistema)
VALUES
  ('Insumos del Local', 'INSUMOS_LOCAL', 'Materiales y suministros para el negocio', 'LOCAL', 'store', 'blue', true),
  ('Servicios Básicos', 'SERVICIOS_BASICOS', 'Agua, luz, internet, telefonía', 'LOCAL', 'lightbulb', 'orange', true),
  ('Mantenimiento', 'MANTENIMIENTO', 'Limpieza y mantenimiento', 'LOCAL', 'build', 'grey', true),
  ('Gastos Personales', 'GASTOS_PERSONALES', 'Retiros o gastos de uso personal', 'PERSONAL', 'person', 'purple', true),
  ('Alimentación', 'ALIMENTACION', 'Comidas y refrigerios', 'PERSONAL', 'restaurant', 'green', true),
  ('Salud', 'SALUD', 'Medicinas y salud', 'PERSONAL', 'medical_services', 'red', true),
  ('Otros', 'OTROS', 'Otros gastos no clasificados', 'PERSONAL', 'help', 'grey', true)
ON CONFLICT (codigo) DO NOTHING;

-- 12. Contadores persistentes para proteger autenticación y recuperación.
CREATE TABLE IF NOT EXISTS public.api_rate_limit_counters (
  bucket_key text PRIMARY KEY,
  hits integer NOT NULL DEFAULT 0,
  reset_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_rate_limit_counters_hits_nonnegative_check CHECK (hits >= 0)
);

CREATE INDEX IF NOT EXISTS idx_api_rate_limit_counters_reset_at
  ON public.api_rate_limit_counters (reset_at);

-- 13. Seguridad Supabase: estas tablas son internas del backend y no se
-- exponen directamente mediante la Data API. El propietario de las tablas y
-- los roles BYPASSRLS conservan acceso para el backend/SQL Editor.
ALTER TABLE public.sidro_client_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sidro_account_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sidro_service_professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sidro_employee_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sidro_employee_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sidro_appointment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sidro_appointment_request_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_calendar_sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_rate_limit_counters ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  relation_name text;
  sequence_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'sidro_client_accounts',
    'sidro_account_links',
    'sidro_service_professionals',
    'sidro_employee_schedules',
    'sidro_employee_blocks',
    'sidro_appointment_requests',
    'sidro_appointment_request_services',
    'google_calendar_sync_queue',
    'expense_categories',
    'api_rate_limit_counters'
  ] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', relation_name);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated', relation_name);
    END IF;
  END LOOP;

  FOREACH sequence_name IN ARRAY ARRAY[
    'sidro_service_professionals_id_seq',
    'sidro_employee_schedules_id_seq',
    'sidro_employee_blocks_id_seq',
    'sidro_appointment_requests_id_seq',
    'sidro_appointment_request_services_id_seq',
    'google_calendar_sync_queue_id_seq',
    'expense_categories_id_seq'
  ] LOOP
    IF to_regclass(format('public.%I', sequence_name)) IS NOT NULL THEN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.%I FROM anon', sequence_name);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.%I FROM authenticated', sequence_name);
      END IF;
    END IF;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.check_sidro_schedule_overlap() FROM PUBLIC;

COMMIT;

-- Verificación informativa: deben aparecer las siete tablas SIDRO y dos tablas
-- operativas auxiliares. Este SELECT no modifica datos.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'sidro_client_accounts',
    'sidro_account_links',
    'sidro_service_professionals',
    'sidro_employee_schedules',
    'sidro_employee_blocks',
    'sidro_appointment_requests',
    'sidro_appointment_request_services',
    'google_calendar_sync_queue',
    'expense_categories',
    'api_rate_limit_counters'
  )
ORDER BY table_name;

SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'sidro_client_accounts',
    'sidro_account_links',
    'sidro_service_professionals',
    'sidro_employee_schedules',
    'sidro_employee_blocks',
    'sidro_appointment_requests',
    'sidro_appointment_request_services',
    'google_calendar_sync_queue',
    'expense_categories',
    'api_rate_limit_counters'
  )
ORDER BY tablename;
