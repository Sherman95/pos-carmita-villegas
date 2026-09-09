-- 1. Tabla Profesionales (Employees)
CREATE TABLE IF NOT EXISTS employees (
	id SERIAL PRIMARY KEY,
	nombre VARCHAR(150) NOT NULL,
	telefono VARCHAR(30),
	active BOOLEAN NOT NULL DEFAULT TRUE,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Modificaciones a la tabla appointments (Agenda de Citas)
CREATE TABLE IF NOT EXISTS appointments (
	id SERIAL PRIMARY KEY,
	client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
	item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
	employee_id INT NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
	fecha_inicio TIMESTAMPTZ NOT NULL,
	fecha_fin TIMESTAMPTZ NOT NULL,
	estado VARCHAR(50) DEFAULT 'PROGRAMADA',
	notas TEXT,
	google_event_id VARCHAR(255),
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Tabla de Configuraciones del Negocio (Google Calendar Sync)
CREATE TABLE IF NOT EXISTS business_config (
	id SERIAL PRIMARY KEY,
	config_key VARCHAR(100) UNIQUE NOT NULL,
	config_value TEXT,
	updated_at TIMESTAMPTZ DEFAULT NOW()
);
