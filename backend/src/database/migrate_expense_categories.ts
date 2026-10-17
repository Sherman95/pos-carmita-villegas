import pool from './db';

export async function initExpenseCategoriesTable() {
  const sql = `
    CREATE TABLE IF NOT EXISTS public.expense_categories (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100) NOT NULL,
      codigo VARCHAR(50) NOT NULL UNIQUE,
      descripcion TEXT,
      tipo VARCHAR(20) NOT NULL DEFAULT 'LOCAL',
      icono VARCHAR(50) NOT NULL DEFAULT 'category',
      color VARCHAR(30) NOT NULL DEFAULT 'blue',
      es_sistema BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    INSERT INTO public.expense_categories (nombre, codigo, descripcion, tipo, icono, color, es_sistema)
    VALUES
      ('Insumos del Local', 'INSUMOS_LOCAL', 'Materiales y suministros para el negocio', 'LOCAL', 'store', 'blue', true),
      ('Servicios Básicos', 'SERVICIOS_BASICOS', 'Agua, luz, internet, telefonía', 'LOCAL', 'lightbulb', 'orange', true),
      ('Mantenimiento', 'MANTENIMIENTO', 'Limpieza y mantenimiento', 'LOCAL', 'build', 'grey', true),
      ('Gastos Personales', 'GASTOS_PERSONALES', 'Retiros o gastos de uso personal', 'PERSONAL', 'person', 'purple', true),
      ('Alimentación', 'ALIMENTACION', 'Comidas, refrigerios', 'PERSONAL', 'restaurant', 'green', true),
      ('Salud', 'SALUD', 'Medicinas y salud', 'PERSONAL', 'medical_services', 'red', true),
      ('Otros', 'OTROS', 'Otros gastos no clasificados', 'PERSONAL', 'help', 'grey', true)
    ON CONFLICT (codigo) DO NOTHING;
  `;

  try {
    await pool.query(sql);
    console.log('[DB] ✅ Tabla expense_categories inicializada y sembrada.');
  } catch (error) {
    console.error('[DB] ❌ Error inicializando tabla expense_categories:', error);
  }
}
