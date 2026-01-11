-- Base de Datos para Salón de Belleza "Carmita Villegas"
-- Motor: PostgreSQL
-- Extensiones requeridas: "uuid-ossp" o "pgcrypto" para gen_random_uuid()

-- 1. Tabla 'users' (Admin y Cajeros)
-- Campos: id (UUID), username, password, role ('admin', 'user'), active (boolean)

-- 2. Tabla 'clients' (Clientes del salón)
-- Campos: id (UUID), nombre, telefono, email, ultima_visita (timestamp)

-- 3. Tabla 'items' (Productos y Servicios)
-- Campos: id (UUID), nombre, precio (DECIMAL), tipo (ENUM: 'PRODUCTO', 'SERVICIO'), stock (INT, nullable)
-- Regla: Si tipo es 'SERVICIO', stock es NULL.

-- 4. Tabla 'sales' (Cabecera de Venta)
-- Campos: id (UUID), fecha (DEFAULT NOW()), total, metodo_pago, client_id (FK)

-- 5. Tabla 'sale_details' (Detalle de Venta)
-- Campos: id (UUID), sale_id (FK), item_id (FK), cantidad, precio_unitario, subtotal

-- ESCRIBE AQUÍ ABAJO EL CÓDIGO SQL PARA CREAR LAS TABLAS:

-- Extensión para UUIDs (elige UNA opción)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
-- Alternativa:
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enum para tipo de ítem
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'item_tipo') THEN
		CREATE TYPE item_tipo AS ENUM ('PRODUCTO', 'SERVICIO');
	END IF;
END $$;

-- 1) users
CREATE TABLE IF NOT EXISTS users (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	username VARCHAR(100) NOT NULL UNIQUE,
	password TEXT NOT NULL,
	role VARCHAR(10) NOT NULL CHECK (role IN ('admin', 'user')),
	active BOOLEAN NOT NULL DEFAULT TRUE,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clients (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	nombre VARCHAR(150) NOT NULL,
	cedula VARCHAR(30),
	telefono VARCHAR(30),
	email VARCHAR(255),
	ultima_visita TIMESTAMPTZ,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	CONSTRAINT clients_email_unique UNIQUE (email),
	CONSTRAINT clients_cedula_unique UNIQUE (cedula)
);

-- 3) items
CREATE TABLE IF NOT EXISTS items (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	nombre VARCHAR(150) NOT NULL,
	precio NUMERIC(12,2) NOT NULL CHECK (precio >= 0),
	tipo item_tipo NOT NULL,
	stock INT NULL CHECK (stock IS NULL OR stock >= 0),
	active BOOLEAN NOT NULL DEFAULT TRUE,
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	CONSTRAINT items_stock_servicio_check
		CHECK (
			(tipo = 'SERVICIO' AND stock IS NULL)
			OR (tipo = 'PRODUCTO')
		)
);

CREATE TABLE IF NOT EXISTS sales (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	total NUMERIC(12,2) NOT NULL CHECK (total >= 0),
	metodo_pago VARCHAR(50) NOT NULL,
	client_id UUID NULL,
	client_nombre VARCHAR(150),
	client_cedula VARCHAR(30),
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	CONSTRAINT sales_client_fk FOREIGN KEY (client_id) REFERENCES clients(id)
		ON UPDATE CASCADE
		ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sale_details (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	sale_id UUID NOT NULL,
	item_id UUID NOT NULL,
	nombre_producto VARCHAR(150) NOT NULL,
	cantidad INT NOT NULL CHECK (cantidad > 0),
	precio_unitario NUMERIC(12,2) NOT NULL CHECK (precio_unitario >= 0),
	subtotal NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
	created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
	CONSTRAINT sale_details_sale_fk FOREIGN KEY (sale_id) REFERENCES sales(id)
		ON UPDATE CASCADE
		ON DELETE CASCADE,
	CONSTRAINT sale_details_item_fk FOREIGN KEY (item_id) REFERENCES items(id)
		ON UPDATE CASCADE
		ON DELETE RESTRICT
);

-- Índices útiles
CREATE INDEX IF NOT EXISTS idx_sales_fecha ON sales (fecha);
CREATE INDEX IF NOT EXISTS idx_sales_client_id ON sales (client_id);
CREATE INDEX IF NOT EXISTS idx_sale_details_sale_id ON sale_details (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_details_item_id ON sale_details (item_id);