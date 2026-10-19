import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { sensitiveRateLimiter, startRateLimitCleanup } from './middlewares/rate-limiters';
import pool from './database/db';
import { initRateLimitTable } from './database/migrate_rate_limits';
import itemsRoutes from './routes/items.routes';
import salesRoutes from './routes/sales.routes';
import clientsRoutes from './routes/clients.routes';
import authRoutes from './routes/auth.routes';
import expensesRoutes from './routes/expenses.routes';
import cashRoutes from './routes/cash.routes';
import reportsRoutes from './routes/reports.routes';
import employeesRoutes from './routes/employees.routes';
import appointmentsRoutes from './routes/appointments.routes';
import businessSettingsRoutes from './routes/businessSettings.routes';
import notificationsRoutes from './routes/notifications.routes';

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET;
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:4200,http://localhost:4201')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('JWT_SECRET es obligatorio y debe tener al menos 32 caracteres');
}
if (isProduction && !process.env.CORS_ORIGINS) {
    throw new Error('CORS_ORIGINS es obligatorio en producción');
}

// Proxy handling is opt-in. Without TRUST_PROXY, Express ignores
// X-Forwarded-For and rate limits key on the real socket address.
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy !== undefined && trustProxy.trim() !== '') {
    const hops = Number(trustProxy);
    if (!Number.isInteger(hops) || hops < 0) {
        throw new Error('TRUST_PROXY debe ser un entero >= 0 (número de proxies de confianza)');
    }
    app.set('trust proxy', hops);
}

// LOG 1: Inicio del servidor
console.log(`[SERVER] 🚀 Iniciando servidor en entorno: ${process.env.NODE_ENV || 'development'}`);

app.use(cors({
    origin: (origin, callback) => {
        // En desarrollo se acepta cualquier puerto local (ng serve puede
        // arrancar en un puerto distinto al 4200/4201). Producción sigue
        // limitada estrictamente a CORS_ORIGINS.
        const isLocalDevOrigin = !isProduction && origin &&
            /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
        if (!origin || allowedOrigins.includes(origin) || isLocalDevOrigin) {
            callback(null, true);
            return;
        }
        callback(null, false);
    }
}));
app.use(helmet());
app.use(sensitiveRateLimiter);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

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
app.use('/api/reports', reportsRoutes);
app.use('/api/employees', employeesRoutes);
app.use('/api/appointments', appointmentsRoutes);
app.use('/api/settings', businessSettingsRoutes);
app.use('/api/notifications', notificationsRoutes);

// SIDRO Routes
import sidroRoutes from './routes/sidro.routes';
import adminSidroRoutes from './routes/adminSidro.routes';

app.use('/api/sidro', sidroRoutes);
app.use('/api/admin/sidro', adminSidroRoutes);

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

import { startGoogleCalendarWorker } from './workers/googleCalendarWorkerPhase5';
import { initExpenseCategoriesTable } from './database/migrate_expense_categories';
import { initNotificationsPhase8Table } from './database/migrateNotificationsPhase8';
import { verifySidroCompleteRegistration85 } from './database/migrateSidroCompleteRegistration85';
import { verifyWebPushPhase9 } from './database/verifyWebPushPhase9';
import { startWebPushWorker, stopWebPushWorker } from './workers/webPushWorkerPhase9';
import { initNotificationsCleanupIndex } from './database/migrateNotificationsCleanup';
import { startNotificationsCleanupWorker, stopNotificationsCleanupWorker } from './workers/notificationsCleanup.worker';

app.listen(PORT, async () => {
    console.log(`[SERVER] 📡 Escuchando en http://localhost:${PORT}`);
    console.log(`[SERVER] 🕒 Hora del sistema: ${new Date().toLocaleString()}`);
    await initExpenseCategoriesTable();
    await initRateLimitTable();
    await initNotificationsPhase8Table();
    await initNotificationsCleanupIndex();
    try {
        const phase85a = await verifySidroCompleteRegistration85();
        if (phase85a.ok) {
            console.log('[SERVER] ✅ Fase 8.5A: migración de registro SIDRO verificada (sin cambios de esquema en arranque)');
        } else {
            console.warn('[SERVER] ⚠️ Fase 8.5A: migración de registro SIDRO pendiente. Ejecuta "npm run migrate:sidro-85a" antes de desplegar. Detalle:', JSON.stringify(phase85a));
        }
    } catch (error) {
        console.error('[SERVER] ⚠️ Fase 8.5A: no se pudo verificar la migración de registro SIDRO:', (error as any)?.message || error);
    }
    startRateLimitCleanup();
    startGoogleCalendarWorker();
    try {
        const pushSchema = await verifyWebPushPhase9();
        if (pushSchema.ok) startWebPushWorker();
        else console.warn('[SERVER] ⚠️ Fase 9 pendiente: aplica web_push_phase9.sql. Faltan:', pushSchema.missing.join(', '));
    } catch (error: any) {
        console.error('[SERVER] ⚠️ No se pudo verificar Web Push:', error?.message || error);
    }
    startNotificationsCleanupWorker();
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
        stopWebPushWorker();
        stopNotificationsCleanupWorker();
    });
}
