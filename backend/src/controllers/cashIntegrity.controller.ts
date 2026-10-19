import { Request, Response } from 'express';
import pool from '../database/db';
import { FinancialError, fromCents, getMovementTotals, requireUuid, toCents } from '../services/financialIntegrity.service';
import { getBusinessDateRange } from '../utils/businessTime';
import { getCashControlEnabled, requireCashControlEnabled } from '../services/cashControl.service';

const sendError = (res: Response, error: unknown, fallback: string) => {
    console.error(error);
    if (error instanceof FinancialError) return res.status(error.status).json({ error: error.message });
    if ((error as any)?.code === '23505') return res.status(409).json({ error: 'Ya existe una caja abierta' });
    return res.status(500).json({ error: fallback });
};

export const getStatus = async (_req: Request, res: Response) => {
    try {
        const [result, controlEnabled] = await Promise.all([
            pool.query(`SELECT * FROM cash_registers WHERE estado = 'ABIERTA' ORDER BY fecha_apertura DESC LIMIT 1`),
            getCashControlEnabled()
        ]);
        return result.rows[0]
            ? res.json({ isOpen: true, controlEnabled, session: result.rows[0] })
            : res.json({ isOpen: false, controlEnabled, message: controlEnabled ? 'Caja cerrada' : 'Control de caja desactivado' });
    } catch (error) {
        return sendError(res, error, 'Error al verificar caja');
    }
};

export const openRegister = async (req: Request, res: Response) => {
    const client = await pool.connect();
    try {
        const initialCents = toCents(req.body?.monto_inicial ?? 0, 'monto_inicial');
        if (initialCents < 0) throw new FinancialError(400, 'El monto inicial no puede ser negativo');
        if (!req.userId) throw new FinancialError(401, 'Usuario no autenticado');
        await client.query('BEGIN');
        await requireCashControlEnabled(client);
        await client.query(`SELECT pg_advisory_xact_lock(hashtext('cash_register_single_open'))`);
        const open = await client.query(`SELECT id FROM cash_registers WHERE estado = 'ABIERTA' LIMIT 1`);
        if (open.rows[0]) throw new FinancialError(409, 'Ya existe una caja abierta. Cierrala primero.');
        const result = await client.query(
            `INSERT INTO cash_registers (monto_inicial, usuario_id, estado) VALUES ($1, $2, 'ABIERTA') RETURNING *`,
            [fromCents(initialCents), req.userId]
        );
        await client.query('COMMIT');
        return res.status(201).json(result.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK');
        return sendError(res, error, 'Error al abrir caja');
    } finally {
        client.release();
    }
};

const buildClosingDetails = async (queryable: any, session: any, end: string | Date) => {
    const totals = await getMovementTotals(queryable, session.fecha_apertura, end);
    const initial = Number(session.monto_inicial);
    const expected = initial + totals.efectivo_ventas + totals.efectivo_abonos - totals.gastos_efectivo;
    return {
        session_id: session.id,
        fecha_apertura: session.fecha_apertura,
        monto_inicial: initial,
        resumen: { efectivo_ventas: totals.efectivo_ventas, efectivo_abonos: totals.efectivo_abonos, digital_total: totals.digital_total },
        total_ventas: totals.total_ingresos,
        total_facturado: totals.total_facturado,
        credito_otorgado: totals.credito_pendiente,
        total_gastos: totals.total_gastos,
        gastos_en_efectivo: totals.gastos_efectivo,
        monto_esperado: Number(expected.toFixed(2))
    };
};

export const getClosingDetails = async (_req: Request, res: Response) => {
    try {
        if (!await getCashControlEnabled()) {
            return res.status(409).json({ error: 'El control de caja está desactivado. El historial de sesiones anteriores continúa disponible.' });
        }
        const result = await pool.query(`SELECT * FROM cash_registers WHERE estado = 'ABIERTA' ORDER BY fecha_apertura DESC LIMIT 1`);
        if (!result.rows[0]) return res.status(404).json({ error: 'No hay caja abierta.' });
        return res.json(await buildClosingDetails(pool, result.rows[0], new Date()));
    } catch (error) {
        return sendError(res, error, 'Error calculando cierre');
    }
};

export const closeRegister = async (req: Request, res: Response) => {
    const client = await pool.connect();
    try {
        const id = requireUuid(req.params.id, 'id de caja');
        const realCents = toCents(req.body?.monto_real, 'monto_real');
        if (realCents < 0) throw new FinancialError(400, 'El monto real no puede ser negativo');
        await client.query('BEGIN');
        await requireCashControlEnabled(client);
        const registerResult = await client.query(`SELECT * FROM cash_registers WHERE id = $1 FOR UPDATE`, [id]);
        const session = registerResult.rows[0];
        if (!session) throw new FinancialError(404, 'Caja no encontrada');
        if (session.estado !== 'ABIERTA') throw new FinancialError(409, 'La caja ya fue cerrada');
        if (!['owner', 'admin'].includes(req.userRole || '') && String(session.usuario_id || '') !== String(req.userId || '')) {
            throw new FinancialError(403, 'Solo quien abrio la caja o un administrador puede cerrarla');
        }
        const timeResult = await client.query('SELECT clock_timestamp() AS now');
        const closeTime = timeResult.rows[0].now;
        const details = await buildClosingDetails(client, session, closeTime);
        const difference = fromCents(realCents - toCents(details.monto_esperado));
        const result = await client.query(
            `UPDATE cash_registers SET fecha_cierre = $1, estado = 'CERRADA', total_ventas_sistema = $2,
                total_gastos_sistema = $3, monto_esperado = $4, monto_real = $5, diferencia = $6, observaciones = $7
             WHERE id = $8 AND estado = 'ABIERTA' RETURNING *`,
            [closeTime, details.total_ventas, details.total_gastos, details.monto_esperado, fromCents(realCents), difference,
             String(req.body?.observaciones || '').trim() || null, id]
        );
        if (!result.rows[0]) throw new FinancialError(409, 'La caja ya fue cerrada');
        await client.query('COMMIT');
        return res.json({ message: 'Caja cerrada correctamente', data: result.rows[0], calculo: details });
    } catch (error) {
        await client.query('ROLLBACK');
        return sendError(res, error, 'Error al cerrar caja');
    } finally {
        client.release();
    }
};

export const getCashHistory = async (req: Request, res: Response) => {
    try {
        const { from, to } = req.query as { from?: string; to?: string };
        const params: unknown[] = [];
        let dateClause = '';
        if ((from && !to) || (!from && to)) throw new FinancialError(400, 'from y to deben enviarse juntos');
        if (from && to) {
            const range = getBusinessDateRange(from, to);
            dateClause = ' AND fecha_cierre >= $1::timestamptz AND fecha_cierre < $2::timestamptz';
            params.push(range.start, range.end);
        }
        const result = await pool.query(
            `SELECT id, fecha_apertura, fecha_cierre, monto_inicial, monto_real AS monto_final, diferencia, usuario_id, estado
             FROM cash_registers WHERE estado = 'CERRADA'${dateClause}
             ORDER BY fecha_cierre DESC${from && to ? '' : ' LIMIT 50'}`,
            params
        );
        return res.json(result.rows);
    } catch (error) {
        return sendError(res, error, 'Error obteniendo historial');
    }
};

export const getClosingReport = async (req: Request, res: Response) => {
    try {
        const id = requireUuid(req.params.id, 'id de caja');
        const result = await pool.query('SELECT * FROM cash_registers WHERE id = $1', [id]);
        const session = result.rows[0];
        if (!session) return res.status(404).json({ error: 'Cierre no encontrado' });
        if (!session.fecha_cierre) return res.status(409).json({ error: 'La caja todavia esta abierta' });
        const details = await buildClosingDetails(pool, session, session.fecha_cierre);
        return res.json({
            ...session,
            total_ventas_efectivo: details.resumen.efectivo_ventas + details.resumen.efectivo_abonos,
            total_gastos: details.gastos_en_efectivo,
            esperado: details.monto_esperado,
            monto_real: Number(session.monto_real || 0),
            diferencia: Number(session.diferencia || 0),
            resumen: details.resumen
        });
    } catch (error) {
        return sendError(res, error, 'Error obteniendo reporte');
    }
};
