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

// ==========================================
// CRUD DE CATEGORÍAS DE GASTOS
// ==========================================

function generateCategoryCode(nombre: string): string {
    return nombre
        .trim()
        .toUpperCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '') || 'CAT';
}

// 4. LISTAR CATEGORÍAS
export const getCategories = async (req: Request, res: Response) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM expense_categories ORDER BY es_sistema DESC, nombre ASC'
        );
        res.json(rows);
    } catch (error) {
        console.error('Error al obtener categorías:', error);
        res.status(500).json({ error: 'Error al obtener categorías de gastos' });
    }
};

// 5. CREAR CATEGORÍA
export const createCategory = async (req: Request, res: Response) => {
    try {
        const { nombre, descripcion, tipo, icono, color } = req.body;

        if (!nombre || !nombre.trim()) {
            return res.status(400).json({ error: 'El nombre de la categoría es obligatorio' });
        }

        const cleanTipo = (tipo === 'PERSONAL' || tipo === 'LOCAL') ? tipo : 'LOCAL';
        const cleanIcono = icono && icono.trim() ? icono.trim() : 'category';
        const cleanColor = color && color.trim() ? color.trim() : 'blue';

        let baseCode = generateCategoryCode(nombre);
        let finalCode = baseCode;
        let suffix = 1;

        while (true) {
            const check = await pool.query('SELECT id FROM expense_categories WHERE codigo = $1', [finalCode]);
            if (check.rows.length === 0) break;
            finalCode = `${baseCode}_${suffix++}`;
        }

        const result = await pool.query(
            `INSERT INTO expense_categories (nombre, codigo, descripcion, tipo, icono, color, es_sistema)
             VALUES ($1, $2, $3, $4, $5, $6, false)
             RETURNING *`,
            [nombre.trim(), finalCode, descripcion?.trim() || null, cleanTipo, cleanIcono, cleanColor]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error al crear categoría:', error);
        res.status(500).json({ error: 'Error al crear la categoría de gasto' });
    }
};

// 6. ACTUALIZAR CATEGORÍA
export const updateCategory = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { nombre, descripcion, tipo, icono, color } = req.body;

        if (!nombre || !nombre.trim()) {
            return res.status(400).json({ error: 'El nombre de la categoría es obligatorio' });
        }

        const existing = await pool.query('SELECT * FROM expense_categories WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Categoría no encontrada' });
        }

        const currentCat = existing.rows[0];
        const cleanTipo = (tipo === 'PERSONAL' || tipo === 'LOCAL') ? tipo : currentCat.tipo;
        const cleanIcono = icono && icono.trim() ? icono.trim() : currentCat.icono;
        const cleanColor = color && color.trim() ? color.trim() : currentCat.color;

        const result = await pool.query(
            `UPDATE expense_categories
             SET nombre = $1, descripcion = $2, tipo = $3, icono = $4, color = $5, updated_at = NOW()
             WHERE id = $6
             RETURNING *`,
            [nombre.trim(), descripcion?.trim() || null, cleanTipo, cleanIcono, cleanColor, id]
        );

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error al actualizar categoría:', error);
        res.status(500).json({ error: 'Error al actualizar la categoría' });
    }
};

// 7. ELIMINAR CATEGORÍA
export const deleteCategory = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const check = await pool.query('SELECT * FROM expense_categories WHERE id = $1', [id]);
        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'Categoría no encontrada' });
        }

        const cat = check.rows[0];

        // Verificar si existen gastos con esta categoría
        const inUse = await pool.query('SELECT COUNT(*) FROM expenses WHERE categoria = $1', [cat.codigo]);
        const count = Number(inUse.rows[0].count);

        if (count > 0) {
            return res.status(400).json({
                error: `No se puede eliminar la categoría "${cat.nombre}" porque tiene ${count} gasto(s) registrado(s). Modifica o elimina los gastos asociados primero.`
            });
        }

        await pool.query('DELETE FROM expense_categories WHERE id = $1', [id]);
        res.json({ message: 'Categoría eliminada exitosamente' });
    } catch (error) {
        console.error('Error al eliminar categoría:', error);
        res.status(500).json({ error: 'Error al eliminar la categoría' });
    }
};
