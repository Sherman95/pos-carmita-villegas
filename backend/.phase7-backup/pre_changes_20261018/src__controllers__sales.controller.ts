import { Request, Response } from 'express';
import pool from '../database/db';
import {
    applyPayment,
    FinancialError,
    fromCents,
    parseReceiptMethod,
    requireOpenRegister,
    requireUuid,
    toCents
} from '../services/financialIntegrity.service';
import { getBusinessDateRange, getBusinessNow, localMinutesToInstant } from '../utils/businessTime';

const getWeekRange = (date: Date) => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay();
    const diffToMonday = (day + 6) % 7; // Monday = 0
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - diffToMonday);
    const nextMonday = new Date(monday);
    nextMonday.setUTCDate(monday.getUTCDate() + 7);
    const toIso = (dt: Date) => dt.toISOString().slice(0, 10);
    return { start: toIso(monday), end: toIso(nextMonday) }; // end exclusive
};


// =================================================================================
// 🟢 FUNCIÓN CREATE SALE (VERSIÓN SEGURA CORREGIDA)
// =================================================================================
export const createSale = async (req: Request, res: Response) => {
    const client = await pool.connect();
    const requestedOperationId = req.body?.operation_id;
    try {
        const { total, items, tipo_pago, client_id, tax_rate, abono_inicial, operation_id } = req.body;
        const operationId = requireUuid(operation_id, 'operation_id');
        if (!Array.isArray(items) || items.length === 0 || items.length > 500) {
            throw new FinancialError(400, 'La venta debe contener entre 1 y 500 detalles');
        }
        const method = String(tipo_pago || 'EFECTIVO').trim().toUpperCase();
        if (!['EFECTIVO', 'TRANSFERENCIA', 'CREDITO'].includes(method)) {
            throw new FinancialError(400, 'Tipo de pago no soportado');
        }
        const taxRate = Number(tax_rate || 0);
        if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1) {
            throw new FinancialError(400, 'Tasa de impuesto invalida');
        }
        let detailSubtotalCents = 0;
        const normalizedItems = items.map((item: any, index: number) => {
            const itemId = requireUuid(item.item?.id || item.item_id || item.id, `item ${index + 1}`);
            const quantity = Number(item.cantidad);
            const unitCents = toCents(item.precioVenta ?? item.precio_unitario, `precio item ${index + 1}`);
            const subtotalCents = toCents(item.subtotal, `subtotal item ${index + 1}`);
            if (!Number.isInteger(quantity) || quantity <= 0) throw new FinancialError(400, 'Las cantidades deben ser enteros positivos');
            if (unitCents < 0 || subtotalCents !== unitCents * quantity) {
                throw new FinancialError(400, `El subtotal del item ${index + 1} no coincide`);
            }
            detailSubtotalCents += subtotalCents;
            return {
                id: itemId,
                name: String(item.item?.nombre || item.nombre_producto || item.nombre || '').trim() || 'Item',
                quantity,
                unit: fromCents(unitCents),
                subtotal: fromCents(subtotalCents)
            };
        });
        const totalCents = toCents(total, 'total');
        const expectedTotalCents = Math.round(detailSubtotalCents * (1 + taxRate));
        if (totalCents <= 0 || totalCents !== expectedTotalCents) {
            throw new FinancialError(400, 'El total no coincide con los detalles e impuestos de la venta');
        }
        const initialPaymentCents = method === 'CREDITO' ? toCents(abono_inicial ?? 0, 'abono_inicial') : totalCents;
        if (initialPaymentCents < 0 || initialPaymentCents > totalCents) {
            throw new FinancialError(400, 'El abono inicial no puede ser negativo ni superar el total');
        }

        await client.query('BEGIN');
        const duplicate = await client.query('SELECT id, client_nombre, total, tipo_pago FROM sales WHERE operation_id = $1 LIMIT 1', [operationId]);
        if (duplicate.rows[0]) {
            if (toCents(duplicate.rows[0].total) !== totalCents || String(duplicate.rows[0].tipo_pago).toUpperCase() !== method) {
                throw new FinancialError(409, 'La clave de operacion ya fue utilizada con otra venta');
            }
            await client.query('COMMIT');
            return res.status(200).json({ message: 'Venta ya registrada', saleId: duplicate.rows[0].id, client_nombre: duplicate.rows[0].client_nombre, idempotent: true });
        }
        await requireOpenRegister(client);

        let clientNombre: string | null = null;
        let clientCedula: string | null = null;
        let validClientId: string | null = null;
        if (client_id) {
            validClientId = requireUuid(client_id, 'client_id');
            const { rows } = await client.query('SELECT nombre, cedula FROM clients WHERE id = $1', [validClientId]);
            if (!rows[0]) throw new FinancialError(400, 'Cliente no encontrado');
            clientNombre = rows[0].nombre;
            clientCedula = rows[0].cedula || null;
        }
        if (method === 'CREDITO' && (!validClientId || validClientId === '51ba64a6-8b6a-4a4b-a70e-1f4042c1f32d')) {
            throw new FinancialError(400, 'Las ventas a credito requieren un cliente identificado');
        }
        const balanceCents = totalCents - initialPaymentCents;
        const paymentStatus = balanceCents === 0 ? 'PAGADO' : initialPaymentCents > 0 ? 'PARCIAL' : 'PENDIENTE';
        const saleQuery = `
            INSERT INTO sales (
                total, tipo_pago, metodo_pago, client_id, client_nombre, client_cedula,
                tax_rate, estado_pago, saldo_pendiente, monto_pagado, total_pagado, operation_id
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11)
            RETURNING id
        `;
        const saleValues = [
            fromCents(totalCents), method, method, validClientId, clientNombre, clientCedula,
            taxRate, paymentStatus, fromCents(balanceCents), fromCents(initialPaymentCents), operationId
        ];
        const saleResult = await client.query(saleQuery, saleValues);
        const saleId = saleResult.rows[0].id;
        const itemQuery = `
            INSERT INTO sale_details (sale_id, item_id, nombre_producto, cantidad, precio_unitario, subtotal)
            VALUES ($1, $2, $3, $4, $5, $6)
        `;
        for (const item of normalizedItems) {
            await client.query(itemQuery, [saleId, item.id, item.name, item.quantity, item.unit, item.subtotal]);
        }
        if (initialPaymentCents > 0) {
            const receiptMethod = method === 'CREDITO' ? 'EFECTIVO' : parseReceiptMethod(method);
            await client.query(`
                INSERT INTO payment_history (sale_id, monto, metodo_pago, notas)
                VALUES ($1, $2, $3, $4)
            `, [saleId, fromCents(initialPaymentCents), receiptMethod, method === 'CREDITO' ? 'Abono Inicial' : 'Pago al contado']);
        }
        await client.query('COMMIT');
        res.status(201).json({ message: 'Venta registrada', saleId, client_nombre: clientNombre, idempotent: false });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ ERROR REAL DEL BACKEND:', error);
        if (error instanceof FinancialError) return res.status(error.status).json({ error: error.message });
        if ((error as any)?.code === '23505') {
            const existing = await pool.query('SELECT id, client_nombre, total, tipo_pago FROM sales WHERE operation_id = $1 LIMIT 1', [requestedOperationId]);
            if (existing.rows[0] && toCents(existing.rows[0].total) === toCents(req.body?.total) && String(existing.rows[0].tipo_pago).toUpperCase() === String(req.body?.tipo_pago || 'EFECTIVO').toUpperCase()) {
                return res.status(200).json({ message: 'Venta ya registrada', saleId: existing.rows[0].id, client_nombre: existing.rows[0].client_nombre, idempotent: true });
            }
            return res.status(409).json({ error: 'La operacion ya fue registrada con otros datos' });
        }
        res.status(500).json({ error: 'Error al procesar la venta' });
    } finally {
        client.release();
    }
};

export const getSales = async (_req: Request, res: Response) => {
    try {
        const { rows } = await pool.query(
            `SELECT 
                s.id, s.total, s.metodo_pago, s.client_id, 
                COALESCE(s.client_nombre, c.nombre) AS client_nombre,
                COALESCE(s.client_cedula, c.cedula) AS client_cedula,
                s.created_at,
                s.tax_rate 
             FROM sales s
             LEFT JOIN clients c ON s.client_id = c.id
             ORDER BY s.created_at DESC`
        );
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error obteniendo ventas:', error);
        res.status(500).json({ error: 'Error al obtener ventas' });
    }
};

export const getSalesByRange = async (req: Request, res: Response) => {
    const { from, to } = req.query as { from?: string; to?: string };

    if (!from || !to) {
        return res.status(400).json({ error: 'from y to son requeridos' });
    }

    try {
        const range = from.includes('T') || to.includes('T')
            ? { start: from, end: to }
            : getBusinessDateRange(from, to);
        const { rows } = await pool.query(
            `SELECT 
                s.id, s.total, s.metodo_pago, s.client_id,
                COALESCE(s.client_nombre, c.nombre) AS client_nombre,
                COALESCE(s.client_cedula, c.cedula) AS client_cedula,
                s.created_at,
                s.tax_rate
             FROM sales s
             LEFT JOIN clients c ON s.client_id = c.id
             WHERE s.created_at >= $1::timestamptz AND s.created_at < $2::timestamptz
             ORDER BY s.created_at DESC`,
            [range.start, range.end]
        );
        res.status(200).json(rows);
    } catch (error) {
        console.error('Error obteniendo ventas por rango:', error);
        res.status(500).json({ error: 'Error al obtener ventas por rango' });
    }
};

export const getSalesSummary = async (req: Request, res: Response) => {
    const { period, year, month, from, to } = req.query as { period?: string; year?: string; month?: string; from?: string; to?: string };

    try {
        let start: string;
        let end: string;

        if (period === 'month') {
            const y = Number(year) || new Date().getFullYear();
            const m = Number(month) || new Date().getMonth() + 1;
            start = `${y}-${String(m).padStart(2, '0')}-01`;
            const nextMonth = m === 12 ? 1 : m + 1;
            const nextYear = m === 12 ? y + 1 : y;
            end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
        } else if (period === 'week') {
            const { start: s, end: e } = getWeekRange(new Date(`${getBusinessNow().date}T00:00:00Z`));
            start = s;
            end = e;
        } else if (period === 'year') {
            const y = Number(year) || new Date().getFullYear();
            start = `${y}-01-01`;
            end = `${y + 1}-01-01`;
        } else if (from && to) {
            if (from.includes('T')) {
                start = from;
                end = to;
            } else {
                const range = getBusinessDateRange(from, to);
                start = range.start;
                end = range.end;
            }
        } else {
            return res.status(400).json({ error: 'Proporciona period=month|year o from/to' });
        }

        if (!start.includes('T')) {
            start = localMinutesToInstant(start, 0);
            end = localMinutesToInstant(end, 0);
        }
        const { rows } = await pool.query(
            `SELECT COUNT(*)::int AS count, COALESCE(SUM(total),0)::numeric AS total
             FROM sales
             WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz`,
            [start, end]
        );

        res.status(200).json(rows[0]);
    } catch (error) {
        console.error('Error obteniendo resumen de ventas:', error);
        res.status(500).json({ error: 'Error al obtener resumen de ventas' });
    }
};

export const getSalesByClient = async (req: Request, res: Response) => {
    const { clientId } = req.params;
    const { period, from, to } = req.query;

    try {
        let dateFilter = '';
        const params: any[] = [clientId];

        if (from && to) {
            const range = getBusinessDateRange(from, to);
            dateFilter = 'AND s.created_at >= $2::timestamptz AND s.created_at < $3::timestamptz';
            params.push(range.start, range.end);
        } else if (period === 'week') {
            dateFilter = "AND s.created_at >= NOW() - INTERVAL '7 days'";
        } else if (period === 'month') {
            dateFilter = "AND s.created_at >= DATE_TRUNC('month', NOW())";
        } else if (period === 'year') {
            dateFilter = "AND s.created_at >= DATE_TRUNC('year', NOW())";
        }

        const salesQuery = `
            SELECT 
                s.id, 
                s.total, 
                s.metodo_pago, 
                s.created_at,
                COALESCE(s.client_nombre, c.nombre) AS client_nombre,
                COALESCE(s.client_cedula, c.cedula) AS client_cedula,
                s.tax_rate as tax_rate
            FROM sales s
            LEFT JOIN clients c ON s.client_id = c.id
            WHERE s.client_id = $1 ${dateFilter}
            ORDER BY s.created_at DESC
        `;

        const { rows: sales } = await pool.query(salesQuery, params);

        const summaryQuery = `
            SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total
            FROM sales s
            WHERE client_id = $1 ${dateFilter}
        `;
        const { rows: summary } = await pool.query(summaryQuery, params);

        res.json({ sales, summary: summary[0] });
    } catch (error) {
        console.error('Error report client:', error);
        res.status(500).json({ error: 'Error obteniendo reporte por cliente' });
    }
};

export const getSalesByItem = async (req: Request, res: Response) => {
    const { itemId } = req.params;
    const { period, from, to } = req.query;

    try {
        let dateFilter = '';
        const params: any[] = [itemId];

        if (from && to) {
            const range = getBusinessDateRange(from, to);
            dateFilter = 'AND s.created_at >= $2::timestamptz AND s.created_at < $3::timestamptz';
            params.push(range.start, range.end);
        } else if (period === 'week') {
            dateFilter = "AND s.created_at >= NOW() - INTERVAL '7 days'";
        } else if (period === 'month') {
            dateFilter = "AND s.created_at >= DATE_TRUNC('month', NOW())";
        } else if (period === 'year') {
            dateFilter = "AND s.created_at >= DATE_TRUNC('year', NOW())";
        }

        const salesQuery = `
            SELECT 
                s.id as sale_id,
                s.created_at,
                s.metodo_pago,
                COALESCE(s.client_nombre, c.nombre) AS client_nombre,
                COALESCE(s.client_cedula, c.cedula) AS client_cedula,
                sd.cantidad,
                sd.precio_unitario,
                sd.subtotal as total,
                s.tax_rate as tax_rate
            FROM sale_details sd
            JOIN sales s ON sd.sale_id = s.id
            LEFT JOIN clients c ON s.client_id = c.id
            WHERE sd.item_id = $1 ${dateFilter}
            ORDER BY s.created_at DESC
        `;

        const { rows: sales } = await pool.query(salesQuery, params);

        const summaryQuery = `
            SELECT 
                COUNT(*) as count, 
                COALESCE(SUM(sd.subtotal), 0) as total
            FROM sale_details sd
            JOIN sales s ON sd.sale_id = s.id
            WHERE sd.item_id = $1 ${dateFilter}
        `;
        const { rows: summary } = await pool.query(summaryQuery, params);

        const mappedSales = sales.map(row => ({
            ...row,
            id: row.sale_id, 
            total: Number(row.total),
            tax_rate: Number(row.tax_rate) 
        }));

        res.json({ sales: mappedSales, summary: summary[0] });
    } catch (error) {
        console.error('Error report item:', error);
        res.status(500).json({ error: 'Error obteniendo reporte por servicio' });
    }
};

export const getSaleWithDetails = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'id requerido' });

    try {
        const saleQuery = `
            SELECT 
                s.id, s.total, s.metodo_pago, s.client_id,
                COALESCE(s.client_nombre, c.nombre) AS client_nombre,
                COALESCE(s.client_cedula, c.cedula) AS client_cedula,
                s.created_at,
                s.tax_rate
            FROM sales s
            LEFT JOIN clients c ON s.client_id = c.id
            WHERE s.id = $1
        `;

        const detailQuery = `
            SELECT 
                sd.id,
                sd.item_id,
                sd.nombre_producto,
                sd.cantidad,
                sd.precio_unitario,
                sd.subtotal,
                i.tipo AS item_tipo
            FROM sale_details sd
            LEFT JOIN items i ON i.id = sd.item_id
            WHERE sd.sale_id = $1
            ORDER BY sd.created_at ASC
        `;

        const [saleResult, detailResult] = await Promise.all([
            pool.query(saleQuery, [id]),
            pool.query(detailQuery, [id])
        ]);

        if (saleResult.rows.length === 0) return res.status(404).json({ error: 'Venta no encontrada' });

        res.status(200).json({ sale: saleResult.rows[0], details: detailResult.rows });
    } catch (error) {
        console.error('Error obteniendo venta con detalle:', error);
        res.status(500).json({ error: 'Error al obtener venta con detalle' });
    }
};

export const getSaleDetailsBatch = async (req: Request, res: Response) => {
    const ids: unknown[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validIds = [...new Set(ids.filter((id): id is string => typeof id === 'string' && uuidPattern.test(id)))];

    if (validIds.length === 0) return res.status(200).json({});
    if (validIds.length > 2000) return res.status(400).json({ error: 'Máximo 2000 ventas por consulta' });

    try {
        const { rows } = await pool.query(
            `SELECT sd.sale_id, sd.id, sd.item_id, sd.nombre_producto,
                    sd.cantidad, sd.precio_unitario, sd.subtotal,
                    i.tipo AS item_tipo
             FROM sale_details sd
             LEFT JOIN items i ON i.id = sd.item_id
             WHERE sd.sale_id = ANY($1::uuid[])
             ORDER BY sd.sale_id, sd.created_at ASC`,
            [validIds]
        );

        const grouped: Record<string, unknown[]> = Object.fromEntries(validIds.map((id) => [id, []]));
        for (const row of rows) grouped[row.sale_id].push(row);
        res.status(200).json(grouped);
    } catch (error) {
        console.error('Error obteniendo detalles agrupados:', error);
        res.status(500).json({ error: 'Error al obtener detalles de ventas' });
    }
};

export const getReceiptsByClient = async (req: Request, res: Response) => {
    const { clientId } = req.params;
    const { from, to } = req.query as { from?: string; to?: string };
    if (!clientId) return res.status(400).json({ error: 'clientId requerido' });

    try {
        const params: any[] = [clientId];
        let dateClause = '';
        if (from && to) {
            const range = getBusinessDateRange(from, to);
            params.push(range.start, range.end);
            dateClause = "AND s.created_at >= $2::timestamptz AND s.created_at < $3::timestamptz";
        }

        const { rows } = await pool.query(
            `SELECT s.id AS receipt_id, s.id AS sale_id, s.created_at AS receipt_created_at,
                    s.total, s.metodo_pago,
                    COALESCE(s.client_nombre, c.nombre) AS client_nombre,
                    COALESCE(s.client_cedula, c.cedula) AS client_cedula,
                    s.created_at AS sale_created_at,
                    'generated'::text AS doc_type
             FROM sales s
             LEFT JOIN clients c ON s.client_id = c.id
             WHERE s.client_id = $1
             ${dateClause}
             ORDER BY s.created_at DESC`,
            params
        );

        res.status(200).json(rows);
    } catch (error) {
        console.error('Error obteniendo recibos por cliente:', error);
        res.status(500).json({ error: 'Error al obtener recibos por cliente' });
    }
};

export const getDebtors = async (_req: Request, res: Response) => {
    try {
        const { rows } = await pool.query(`
            SELECT 
                s.id, s.created_at, s.total, s.saldo_pendiente, s.estado_pago,
                c.id as client_id, c.nombre, c.cedula, c.telefono
            FROM sales s
            JOIN clients c ON s.client_id = c.id
            WHERE s.estado_pago IN ('PENDIENTE', 'PARCIAL')
            AND s.saldo_pendiente > 0.01 
            ORDER BY s.created_at DESC
        `);

        const agrupado: Record<string, any> = {};

        rows.forEach((row) => {
            const cid = row.client_id;
            if (!agrupado[cid]) {
                agrupado[cid] = {
                    cliente_id: cid,
                    nombre: row.nombre,
                    telefono: row.telefono, 
                    total_deuda: 0,
                    ventas_pendientes: 0,
                    ventas: []
                };
            }
            const saldo = Number(row.saldo_pendiente);
            agrupado[cid].total_deuda += saldo;
            agrupado[cid].ventas_pendientes++;
            agrupado[cid].ventas.push({
                id: row.id,
                created_at: row.created_at,
                total: Number(row.total),
                saldo_pendiente: saldo
            });
        });

        res.status(200).json(Object.values(agrupado));
    } catch (error) {
        console.error('Error obteniendo deudores:', error);
        res.status(500).json({ error: 'Error al obtener cartera vencida' });
    }
};


export const registerPayment = async (req: Request, res: Response) => {
    const { saleId, monto, metodo_pago, operation_id } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await requireOpenRegister(client);
        const result = await applyPayment(client, { saleId, amount: monto, method: metodo_pago, operationId: operation_id });
        await client.query('COMMIT');
        res.status(200).json({ message: result.idempotent ? 'Abono ya registrado' : 'Abono registrado correctamente', ...result });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error registrando abono:', error);
        if (error instanceof FinancialError) return res.status(error.status).json({ error: error.message });
        if ((error as any)?.code === '23505') {
            const existing = await pool.query(
                `SELECT sale_id, monto, metodo_pago FROM payment_history WHERE operation_id = $1 LIMIT 1`,
                [operation_id]
            );
            if (existing.rows[0]
                && String(existing.rows[0].sale_id) === String(saleId)
                && toCents(existing.rows[0].monto) === toCents(monto)
                && parseReceiptMethod(existing.rows[0].metodo_pago) === parseReceiptMethod(metodo_pago)) {
                return res.status(200).json({ message: 'Abono ya registrado', idempotent: true, saleId });
            }
            return res.status(409).json({ error: 'La operacion ya fue utilizada con otros datos' });
        }
        res.status(500).json({ error: 'Error al registrar el pago' });
    } finally {
        client.release();
    }
};
