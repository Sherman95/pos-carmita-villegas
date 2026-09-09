import { Pool } from 'pg';
import dns from 'node:dns';
import dotenv from 'dotenv';

dotenv.config();

// Configuración DNS para Render
try {
    dns.setDefaultResultOrder('ipv4first');
} catch {
    // No-op
}

const databaseUrl = process.env.DATABASE_URL;

// LOG 1: Saber qué configuración estamos usando
// LOG 1: Saber qué configuración estamos usando
console.log(`[DB] 🔧 Iniciando configuración...`);
console.log(`[DB] 🌍 DATABASE_URL detectada: ${databaseUrl ? 'SÍ' : 'NO'}`);

const pool = databaseUrl
    ? new Pool({
        connectionString: databaseUrl,
        // MAGIA: Solo activará el SSL si la URL NO dice "localhost"
        ...(databaseUrl.includes('localhost') ? {} : { ssl: { rejectUnauthorized: false } }),
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
    })
    : new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 5432,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        ...(process.env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: false } } : {}),
    });

// LOG 2: Cuando se crea una conexión nueva en el pool
pool.on('connect', () => {
    console.log('🔥 [DB] Nuevo cliente conectado al pool');
});

// LOG 3: Errores críticos de conexión
pool.on('error', (err) => {
    console.error('❌ [DB] Error INESPERADO en el pool:', err.message);
});

// LOG 4: Prueba de conexión inmediata al iniciar
// Esto nos avisa apenas arranca el servidor si la BD responde
pool.query('SELECT NOW()')
    .then((res) => {
        console.log(`✅ [DB] Conexión VERIFICADA exitosamente. Hora BD: ${res.rows[0].now}`);
    })
    .catch((err) => {
        console.error(`❌ [DB] FALLÓ la conexión inicial: ${err.message}`);
    });

export default pool;