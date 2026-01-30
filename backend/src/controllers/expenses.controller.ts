import { Request, Response } from 'express';
// ⚠️ IMPORTANTE: Verifica que esta ruta a tu base de datos sea correcta. 
// Si tu archivo se llama db.ts o database.ts, ajusta la ruta si es necesario.
import pool from '../database/db'; 

export const createExpense = async (req: Request, res: Response) => {
    try {
        // 👇 1. SEGURIDAD: VERIFICAR CAJA ABIERTA
        const cajaCheck = await pool.query(
            "SELECT id FROM cash_registers WHERE estado = 'ABIERTA' LIMIT 1"
        );

        if (cajaCheck.rows.length === 0) {
            return res.status(403).json({ 
                error: '⛔ LA CAJA ESTÁ CERRADA. Abre turno para registrar gastos.' 
            });
        }
        // 👆 FIN SEGURIDAD

        const { descripcion, monto, categoria, metodo_pago } = req.body; 

        // Validación básica
        if (!descripcion || !monto) {
            return res.status(400).json({ error: 'Descripción y monto son obligatorios' });
        }

        // Si no envían método, asumimos EFECTIVO por defecto
        const metodo = metodo_pago || 'EFECTIVO'; 

        // Insertar Gasto
        const result = await pool.query(
            'INSERT INTO expenses (descripcion, monto, categoria, metodo_pago, fecha) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
            [descripcion, monto, categoria, metodo]
        );
        
        res.status(201).json(result.rows[0]);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al registrar el gasto' });
    }
};

// 2. LISTAR GASTOS (Con cálculo de total)
export const getExpenses = async (req: Request, res: Response) => {
    // Recibimos filtros opcionales (por si quieres ver solo lo de "hoy")
    const { from, to, categoria } = req.query as { from?: string; to?: string; categoria?: string };

    try {
        let query = 'SELECT * FROM expenses WHERE 1=1';
        const params: any[] = [];
        let count = 1;

        // Filtro de fechas
        if (from && to) {
            query += ` AND fecha >= $${count}::timestamptz AND fecha <= $${count+1}::timestamptz`;
            // Ajuste para cubrir todo el día final
            const toDate = new Date(to);
            toDate.setHours(23, 59, 59, 999);
            params.push(from, toDate.toISOString());
            count += 2;
        }

        // Filtro de categoría
        if (categoria && categoria !== 'TODAS') {
            query += ` AND categoria = $${count}`;
            params.push(categoria);
            count++;
        }

        query += ' ORDER BY fecha DESC';

        const { rows } = await pool.query(query, params);

        // Sumamos el total aquí mismo para facilitarle la vida al Frontend
        const total = rows.reduce((sum, item) => sum + Number(item.monto), 0);

        res.json({ expenses: rows, total });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener gastos' });
    }
};

// 3. BORRAR GASTO
export const deleteExpense = async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM expenses WHERE id = $1', [id]);
        res.json({ message: 'Gasto eliminado' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar' });
    }
};