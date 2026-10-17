import { Request, Response } from 'express';
import pool from '../database/db'; 
import { getBusinessDateRange } from '../utils/businessTime';

// Obtener gastos por rango de fecha (Para el Gráfico de Pastel)
export const getExpensesReport = async (req: Request, res: Response) => {
    try {
        const { from, to } = req.query;

        // Validamos que vengan las fechas
        if (!from || !to) {
            return res.status(400).json({ error: 'Faltan fechas (from, to)' });
        }

        let range;
        try { range = getBusinessDateRange(from, to); }
        catch { return res.status(400).json({ error: 'Rango de fechas invalido' }); }
        const result = await pool.query(`
            SELECT * FROM expenses 
            WHERE fecha >= $1::timestamptz AND fecha < $2::timestamptz
            ORDER BY fecha DESC
        `, [range.start, range.end]);

        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error obteniendo reporte de gastos' });
    }
};
