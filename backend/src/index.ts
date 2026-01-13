import express, { Request, Response } from 'express';
import cors from 'cors';
import pool from './database/db'; 
import itemsRoutes from './routes/items.routes';
// 1. IMPORTANTE: Importar las rutas de ventas
import salesRoutes from './routes/sales.routes'; 
import clientsRoutes from './routes/clients.routes';
import authRoutes from './routes/auth.routes';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// =======================================================================
// CORRECCIÓN: AUMENTAR EL LÍMITE DE TAMAÑO
// Esto permite que entren los PDFs en Base64 (hasta 50MB)
// =======================================================================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// =======================================================================

// Rutas
app.use('/api/items', itemsRoutes);
// 2. IMPORTANTE: Usar las rutas de ventas
app.use('/api/sales', salesRoutes); 
app.use('/api/clients', clientsRoutes);
app.use('/api/auth', authRoutes);

app.get('/ping', async (req: Request, res: Response) => {
    try {
        const result = await pool.query('SELECT NOW()');
        res.json({ 
            mensaje: 'Pong! Carmita Villegas API activa', 
            hora_db: result.rows[0].now 
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error de conexión a BD' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});