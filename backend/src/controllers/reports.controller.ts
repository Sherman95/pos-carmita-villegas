import { Request, Response } from 'express';
import pool from '../database/db'; 

// Obtener gastos por rango de fecha (Para el Gráfico de Pastel)
export const getExpensesReport = async (req: Request, res: Response) => {
    try {
        const { from, to } = req.query;

        // Validamos que vengan las fechas
        if (!from || !to) {
            return res.status(400).json({ error: 'Faltan fechas (from, to)' });
        }

        const result = await pool.query(`
            SELECT * FROM expenses 
            WHERE fecha BETWEEN $1 AND $2
            ORDER BY fecha DESC
        `, [from, to]);

        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error obteniendo reporte de gastos' });
    }
};