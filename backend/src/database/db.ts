import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Configura la conexión usando las variables de entorno
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
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