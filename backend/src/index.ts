import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import pool from './database/db'; 
import itemsRoutes from './routes/items.routes';
import salesRoutes from './routes/sales.routes'; 
import clientsRoutes from './routes/clients.routes';
import authRoutes from './routes/auth.routes';
import expensesRoutes from './routes/expenses.routes';
import cashRoutes from './routes/cash.routes';

const app = express();
const PORT = process.env.PORT || 3000;

// LOG 1: Inicio del servidor
console.log(`[SERVER] 🚀 Iniciando servidor en entorno: ${process.env.NODE_ENV || 'development'}`);

app.use(cors());

// Aumentar límite para PDFs/imágenes
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// =======================================================================
// NUEVO: Middleware de Logging (Registro de Tráfico)
// =======================================================================
app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    // Cuando la petición termine (finish), calculamos cuánto tardó
    res.on('finish', () => {
        const duration = Date.now() - start;
        const statusColor = res.statusCode >= 400 ? '❌' : '✅';
        console.log(`[REQ] ${statusColor} ${req.method} ${req.originalUrl} - Estado: ${res.statusCode} - Tiempo: ${duration}ms`);
    });
    next();
});
// =======================================================================

// Rutas
console.log('[SERVER] 📂 Cargando rutas...');
app.use('/api/items', itemsRoutes);
app.use('/api/sales', salesRoutes); 
app.use('/api/clients', clientsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/cash', cashRoutes);

// Ruta Ping (Para UptimeRobot)
app.get('/ping', async (req: Request, res: Response) => {
    try {
        // Hacemos una consulta real para asegurar que la BD no esté dormida
        const result = await pool.query('SELECT NOW()');
        res.json({ 
            mensaje: 'Pong! 🏓 API activa', 
            hora_db: result.rows[0].now,
            uptime: process.uptime() // Cuántos segundos lleva prendido el server
        });
    } catch (error) {
        console.error('[PING] ❌ Error verificando BD:', error);
        res.status(500).json({ error: 'Error de conexión a BD' });
    }
});

// Manejo global de errores (por si algo explota)
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('[SERVER] 💥 Error no controlado:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, () => {
    console.log(`[SERVER] 📡 Escuchando en http://localhost:${PORT}`);
    console.log(`[SERVER] 🕒 Hora del sistema: ${new Date().toLocaleString()}`);
});