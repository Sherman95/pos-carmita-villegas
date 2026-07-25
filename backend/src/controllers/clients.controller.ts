import { Request, Response } from 'express';
import pool from '../database/db';

export const getClients = async (_req: Request, res: Response) => {
    try {
        // ACTUALIZADO: Agregamos 'direccion' a la lista de columnas seleccionadas
        const { rows } = await pool.query(
            'SELECT id, nombre, cedula, telefono, email, direccion, ultima_visita, created_at, updated_at FROM clients ORDER BY nombre ASC'
        );
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error obteniendo clientes:', error);
        res.status(500).json({ error: 'Error al obtener clientes' });
    }
};

export const createClient = async (req: Request, res: Response) => {
    // ACTUALIZADO: Recibimos 'direccion' del body
    const { nombre, cedula, telefono, email, direccion } = req.body;

    if (!nombre) {
        return res.status(400).json({ error: 'nombre es requerido' });
    }

    try {
        // ACTUALIZADO: Agregamos la columna y el valor ($5)
        const { rows } = await pool.query(
            'INSERT INTO clients (nombre, cedula, telefono, email, direccion) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [nombre, cedula || null, telefono || null, email || null, direccion || null]
        );
        res.status(201).json(rows[0]);
    } catch (error: any) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Email o cédula ya existe' });
        }
        console.error('Error creando cliente:', error);
        res.status(500).json({ error: 'Error al crear cliente' });
    }
};

export const updateClient = async (req: Request, res: Response) => {
    const { id } = req.params;
    // ACTUALIZADO: Recibimos 'direccion'
    const { nombre, cedula, telefono, email, direccion, ultima_visita } = req.body;

    if (!id) return res.status(400).json({ error: 'id es requerido' });
    if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });

    try {
        // ACTUALIZADO: Agregamos direccion=$5 y ajustamos los índices ($6, $7)
        const { rows, rowCount } = await pool.query(
            `UPDATE clients
             SET nombre = $1, cedula = $2, telefono = $3, email = $4, direccion = $5, ultima_visita = $6, updated_at = NOW()
             WHERE id = $7
             RETURNING *`,
            [nombre, cedula || null, telefono || null, email || null, direccion || null, ultima_visita || null, id]
        );

        if (rowCount === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
        res.status(200).json(rows[0]);
    } catch (error: any) {
        if (error.code === '23505') {
            return res.status(400).json({ error: 'Email o cédula ya existe' });
        }
        console.error('Error actualizando cliente:', error);
        res.status(500).json({ error: 'Error al actualizar cliente' });
    }
};

export const getClientDeletionImpact = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'id es requerido' });

    try {
        const { rows, rowCount } = await pool.query(
            `SELECT c.id,
                    c.nombre,
                    c.cedula,
                    COUNT(s.id)::int AS sales_count,
                    COUNT(s.id) FILTER (
                        WHERE s.estado_pago = 'PENDIENTE'
                          AND s.saldo_pendiente > 0.01
                    )::int AS pending_debt_count,
                    COALESCE(SUM(s.saldo_pendiente) FILTER (
                        WHERE s.estado_pago = 'PENDIENTE'
                          AND s.saldo_pendiente > 0.01
                    ), 0) AS pending_debt_amount
             FROM clients c
             LEFT JOIN sales s ON s.client_id = c.id
             WHERE c.id = $1
             GROUP BY c.id, c.nombre, c.cedula`,
            [id]
        );

        if (rowCount === 0) return res.status(404).json({ error: 'Cliente no encontrado' });

        const client = rows[0];
        res.status(200).json({
            clientName: client.nombre,
            salesCount: client.sales_count,
            pendingDebtCount: client.pending_debt_count,
            pendingDebtAmount: Number(client.pending_debt_amount),
            isFinalConsumer: client.cedula === '9999999999'
        });
    } catch (error) {
        console.error('Error consultando impacto de eliminación:', error);
        res.status(500).json({ error: 'No se pudo verificar si el cliente puede eliminarse' });
    }
};

export const deleteClient = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'id es requerido' });

    const dbClient = await pool.connect();

    try {
        await dbClient.query('BEGIN');

        const clientResult = await dbClient.query(
            'SELECT id, nombre, cedula FROM clients WHERE id = $1 FOR UPDATE',
            [id]
        );
        if (clientResult.rowCount === 0) {
            await dbClient.query('ROLLBACK');
            return res.status(404).json({ error: 'Cliente no encontrado' });
        }

        const clientToDelete = clientResult.rows[0];
        if (clientToDelete.cedula === '9999999999') {
            await dbClient.query('ROLLBACK');
            return res.status(400).json({ error: 'No se puede eliminar al Consumidor Final' });
        }

        const pendingDebt = await dbClient.query(
            `SELECT COUNT(*)::int AS count,
                    COALESCE(SUM(saldo_pendiente), 0) AS amount
             FROM sales
             WHERE client_id = $1
               AND estado_pago = 'PENDIENTE'
               AND saldo_pendiente > 0.01`,
            [id]
        );
        if (pendingDebt.rows[0].count > 0) {
            await dbClient.query('ROLLBACK');
            return res.status(409).json({
                error: 'No se puede eliminar: el cliente tiene deudas pendientes',
                pendingDebtCount: pendingDebt.rows[0].count,
                pendingDebtAmount: Number(pendingDebt.rows[0].amount)
            });
        }

        const finalConsumerResult = await dbClient.query(
            `SELECT id, nombre, cedula
             FROM clients
             WHERE cedula = '9999999999'
             LIMIT 1
             FOR UPDATE`
        );
        if (finalConsumerResult.rowCount === 0) {
            throw new Error('No existe el cliente Consumidor Final');
        }

        const finalConsumer = finalConsumerResult.rows[0];
        const movedSales = await dbClient.query(
            `UPDATE sales
             SET client_id = $1,
                 client_nombre = $2,
                 client_cedula = $3,
                 updated_at = NOW()
             WHERE client_id = $4`,
            [finalConsumer.id, finalConsumer.nombre, finalConsumer.cedula, id]
        );

        await dbClient.query('DELETE FROM clients WHERE id = $1', [id]);
        await dbClient.query('COMMIT');

        res.status(200).json({
            message: 'Cliente eliminado correctamente',
            reassignedSales: movedSales.rowCount ?? 0
        });
    } catch (error) {
        await dbClient.query('ROLLBACK');
        console.error('Error eliminando cliente:', error);
        res.status(500).json({ error: 'Error al eliminar cliente' });
    } finally {
        dbClient.release();
    }
};

export default {
    getClients,
    createClient,
    updateClient,
    getClientDeletionImpact,
    deleteClient,
};
