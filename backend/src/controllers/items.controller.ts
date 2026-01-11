import { Request, Response } from 'express';
import pool from '../database/db';

export const getItems = async (_req: Request, res: Response) => {
    try {
        const { rows } = await pool.query(
            'SELECT id, nombre, precio, tipo, stock, active, created_at, updated_at FROM items ORDER BY nombre ASC'
        );
        res.status(200).json(rows);
    } catch (err) {
        console.error('Error al obtener items', err);
        res.status(500).json({ message: 'Error al obtener items' });
    }
};

export const createItem = async (req: Request, res: Response) => {
    const { nombre, precio, tipo, stock } = req.body;

    try {
        if (!nombre || precio === undefined || precio === null || !tipo) {
            return res.status(400).json({ message: 'nombre, precio y tipo son obligatorios' });
        }

        if (tipo !== 'PRODUCTO' && tipo !== 'SERVICIO') {
            return res.status(400).json({ message: "tipo debe ser 'PRODUCTO' o 'SERVICIO'" });
        }

        const precioNumber = Number(precio);
        if (Number.isNaN(precioNumber) || precioNumber < 0) {
            return res.status(400).json({ message: 'precio debe ser un número positivo' });
        }

        let finalStock: number | null = null;
        if (tipo === 'SERVICIO') {
            finalStock = null;
        } else {
            const stockNumber = Number(stock);
            if (stock === undefined || stock === null || Number.isNaN(stockNumber) || stockNumber < 0) {
                return res.status(400).json({ message: 'stock es obligatorio y debe ser un número no negativo para PRODUCTO' });
            }
            finalStock = stockNumber;
        }

        const { rows } = await pool.query(
            'INSERT INTO items (nombre, precio, tipo, stock) VALUES ($1, $2, $3, $4) RETURNING *',
            [nombre, precioNumber, tipo, finalStock]
        );

        res.status(201).json(rows[0]);
    } catch (err) {
        console.error('Error al crear item', err);
        res.status(500).json({ message: 'Error al crear item' });
    }
};

export const updateItem = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { nombre, precio, tipo, stock, active } = req.body;

    if (!id) return res.status(400).json({ message: 'id es obligatorio' });
    if (!nombre || precio === undefined || precio === null || !tipo) {
        return res.status(400).json({ message: 'nombre, precio y tipo son obligatorios' });
    }
    if (tipo !== 'PRODUCTO' && tipo !== 'SERVICIO') {
        return res.status(400).json({ message: "tipo debe ser 'PRODUCTO' o 'SERVICIO'" });
    }

    const precioNumber = Number(precio);
    if (Number.isNaN(precioNumber) || precioNumber < 0) {
        return res.status(400).json({ message: 'precio debe ser un número positivo' });
    }

    let finalStock: number | null = null;
    if (tipo === 'SERVICIO') {
        finalStock = null;
    } else {
        const stockNumber = Number(stock);
        if (stock === undefined || stock === null || Number.isNaN(stockNumber) || stockNumber < 0) {
            return res.status(400).json({ message: 'stock es obligatorio y debe ser un número no negativo para PRODUCTO' });
        }
        finalStock = stockNumber;
    }

    try {
        const { rows, rowCount } = await pool.query(
            `UPDATE items
             SET nombre = $1, precio = $2, tipo = $3, stock = $4, active = COALESCE($5, active), updated_at = NOW()
             WHERE id = $6
             RETURNING *`,
            [nombre, precioNumber, tipo, finalStock, active, id]
        );

        if (rowCount === 0) return res.status(404).json({ message: 'Item no encontrado' });
        res.status(200).json(rows[0]);
    } catch (err) {
        console.error('Error al actualizar item', err);
        res.status(500).json({ message: 'Error al actualizar item' });
    }
};

export const deleteItem = async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id) {
        return res.status(400).json({ message: 'id es obligatorio' });
    }

    try {
        const result = await pool.query('DELETE FROM items WHERE id = $1 RETURNING id', [id]);

        if (result.rowCount === 0) {
            return res.status(400).json({ message: 'Item no encontrado' });
        }

        res.status(200).json({ message: 'Item eliminado' });
    } catch (err: any) {
        if (err && err.code === '23503') {
            return res.status(400).json({ message: 'No se puede eliminar: el item tiene ventas asociadas' });
        }

        console.error('Error al eliminar item', err);
        res.status(500).json({ message: 'Error al eliminar item' });
    }
};

export default {
    getItems,
    createItem,
    updateItem,
    deleteItem,
};
