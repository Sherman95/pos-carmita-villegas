import { Request, Response } from 'express';
import pool from '../database/db';

export const getEmployees = async (_req: Request, res: Response) => {
    try {
        const { rows } = await pool.query(
            'SELECT id, nombre, telefono, active FROM employees WHERE active = true ORDER BY nombre ASC'
        );
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error obteniendo empleados:', error);
        res.status(500).json({ error: 'Error al obtener empleados' });
    }
};

export const createEmployee = async (req: Request, res: Response) => {
    const { nombre, telefono } = req.body;
    if (!nombre) {
        return res.status(400).json({ error: 'Falta el nombre' });
    }

    try {
        const { rows } = await pool.query(
            'INSERT INTO employees (nombre, telefono, active) VALUES ($1, $2, true) RETURNING *',
            [nombre, telefono || null]
        );
        res.status(201).json(rows[0]);
    } catch (error) {
        console.error('Error creando empleado:', error);
        res.status(500).json({ error: 'Error al crear empleado' });
    }
};

export const updateEmployee = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { nombre, telefono } = req.body;

    if (!nombre) {
        return res.status(400).json({ error: 'Falta el nombre' });
    }

    try {
        const { rows, rowCount } = await pool.query(
            'UPDATE employees SET nombre = $1, telefono = $2 WHERE id = $3 RETURNING *',
            [nombre, telefono || null, id]
        );
        
        if (rowCount === 0) return res.status(404).json({ error: 'Empleado no encontrado' });
        res.status(200).json(rows[0]);
    } catch (error) {
        console.error('Error actualizando empleado:', error);
        res.status(500).json({ error: 'Error al actualizar empleado' });
    }
};

export const deleteEmployee = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        // Soft delete: cambiar active a false
        const { rowCount } = await pool.query(
            'UPDATE employees SET active = false WHERE id = $1',
            [id]
        );
        
        if (rowCount === 0) return res.status(404).json({ error: 'Empleado no encontrado' });
        res.status(200).json({ message: 'Empleado eliminado correctamente' });
    } catch (error) {
        console.error('Error eliminando empleado:', error);
        res.status(500).json({ error: 'Error al eliminar empleado' });
    }
};

export default {
    getEmployees,
    createEmployee,
    updateEmployee,
    deleteEmployee
};
