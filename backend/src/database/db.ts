import { Pool } from 'pg';
import dns from 'node:dns';
import dotenv from 'dotenv';

dotenv.config();

// Render (y otros hosts) a veces resuelve Supabase a IPv6; si el entorno no tiene salida IPv6
// la conexión falla con ENETUNREACH. Forzamos a preferir IPv4.
try {
    dns.setDefaultResultOrder('ipv4first');
} catch {
    // No-op: en versiones viejas de Node esta API puede no existir
}

const databaseUrl = process.env.DATABASE_URL;
const shouldUseSsl =
    process.env.DB_SSL === 'true' ||
    (!!databaseUrl && process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test');

// Configura la conexión usando DATABASE_URL (prod) o variables separadas (local)
const pool = databaseUrl
    ? new Pool({
          connectionString: databaseUrl,
          ...(shouldUseSsl ? { ssl: { rejectUnauthorized: false } } : {}),
      })
    : new Pool({
          host: process.env.DB_HOST || 'localhost',
          port: Number(process.env.DB_PORT) || 5432,
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME,
          ...(shouldUseSsl ? { ssl: { rejectUnauthorized: false } } : {}),
      });

// Agrega un console.log cuando se conecte exitosamente
pool.on('connect', () => {
    console.log('🔥 Conexión a Base de Datos CARMITA VILLEGAS exitosa');
});

// Loguea errores del pool para diagnosticar problemas de conexión
pool.on('error', (err) => {
    console.error('Error en el pool de PostgreSQL:', err);
});

export default pool;