import { Request, Response } from 'express';
import pool from '../database/db';

export const getClients = async (_req: Request, res: Response) => {
    try {
        const { rows } = await pool.query(
            'SELECT id, nombre, cedula, telefono, email, ultima_visita, created_at, updated_at FROM clients ORDER BY nombre ASC'
        );
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error obteniendo clientes:', error);
        res.status(500).json({ error: 'Error al obtener clientes' });
    }
};

export const createClient = async (req: Request, res: Response) => {
    const { nombre, cedula, telefono, email } = req.body;

    if (!nombre) {
        return res.status(400).json({ error: 'nombre es requerido' });
    }

    try {
        const { rows } = await pool.query(
            'INSERT INTO clients (nombre, cedula, telefono, email) VALUES ($1, $2, $3, $4) RETURNING *',
            [nombre, cedula || null, telefono || null, email || null]
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
    const { nombre, cedula, telefono, email, ultima_visita } = req.body;

    if (!id) return res.status(400).json({ error: 'id es requerido' });
    if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });

    try {
        const { rows, rowCount } = await pool.query(
            `UPDATE clients
             SET nombre = $1, cedula = $2, telefono = $3, email = $4, ultima_visita = $5, updated_at = NOW()
             WHERE id = $6
             RETURNING *`,
            [nombre, cedula || null, telefono || null, email || null, ultima_visita || null, id]
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

export const deleteClient = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'id es requerido' });

    try {
        const result = await pool.query('DELETE FROM clients WHERE id = $1 RETURNING id', [id]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
        res.status(200).json({ message: 'Cliente eliminado' });
    } catch (error: any) {
        if (error.code === '23503') {
            return res.status(400).json({ error: 'No se puede eliminar: cliente tiene ventas asociadas' });
        }
        console.error('Error eliminando cliente:', error);
        res.status(500).json({ error: 'Error al eliminar cliente' });
    }
};

export default {
    getClients,
    createClient,
    updateClient,
    deleteClient,
};
