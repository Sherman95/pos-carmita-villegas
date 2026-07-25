import { Request, Response } from 'express';
import pool from '../database/db';

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

    try {
        // 👇👇👇 1. BLOQUE DE SEGURIDAD (NUEVO) 👇👇👇
        // Verificamos si existe una caja abierta antes de hacer nada.
        const cajaCheck = await client.query(
            "SELECT id FROM cash_registers WHERE estado = 'ABIERTA' LIMIT 1"
        );

        if (cajaCheck.rows.length === 0) {
            // Si no hay caja, detenemos todo aquí mismo.
            // El 'finally' al final se encargará de liberar el cliente.
            return res.status(403).json({ 
                error: '⛔ LA CAJA ESTÁ CERRADA. Debes abrir turno para poder vender.' 
            });
        }
        // 👆👆👆 FIN DEL BLOQUE DE SEGURIDAD 👆👆👆


        const { total, items, tipo_pago, client_id, tax_rate, abono_inicial } = req.body;
    
        let clientNombre: string | null = null;
        let clientCedula: string | null = null;
        
        // Búsqueda de datos del cliente
        if (client_id) {
            // Validamos que el ID tenga formato UUID para evitar errores de sintaxis SQL
            const isUUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(client_id);
            
            if (isUUID) {
                const { rows } = await client.query('SELECT nombre, cedula FROM clients WHERE id = $1', [client_id]);
                if (rows.length > 0) {
                    clientNombre = rows[0].nombre;
                    clientCedula = rows[0].cedula || null;
                }
            } else {
                 console.warn('ID de cliente no válido, se registrará sin cliente:', client_id);
            }
        }

        // ============================================================
        // 🧠 LÓGICA DE DINERO REAL
        // ============================================================
        let estadoPago = 'PAGADO';
        let saldoPendiente = 0;
        
        const metodo = tipo_pago || 'EFECTIVO';
        const abono = Number(abono_inicial) || 0; 
        let dineroRealEntrante = 0; 

        if (metodo === 'CREDITO') {
            estadoPago = 'PENDIENTE';
            saldoPendiente = Number(total) - abono;
            dineroRealEntrante = abono; 
        } else {
            dineroRealEntrante = Number(total);
        }
        // ============================================================

        await client.query('BEGIN');

        // 2. INSERTAR CABECERA
        const saleQuery = `
            INSERT INTO sales (
                total, 
                tipo_pago,    
                metodo_pago,  
                client_id, 
                client_nombre, 
                client_cedula, 
                tax_rate,
                estado_pago,      
                saldo_pendiente,
                monto_pagado 
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
            RETURNING id
        `;

        const validClientId = (client_id && client_id.length > 10) ? client_id : null;

        const saleValues = [
            total,              // $1
            metodo,             // $2 (tipo_pago)
            metodo,             // $3 (metodo_pago)
            validClientId,      // $4
            clientNombre,       // $5
            clientCedula,       // $6
            tax_rate || 0,      // $7
            estadoPago,         // $8
            saldoPendiente,     // $9
            dineroRealEntrante  // $10
        ];

        const saleResult = await client.query(saleQuery, saleValues);
        const saleId = saleResult.rows[0].id;

        // 3. INSERTAR DETALLES
        const itemQuery = `
            INSERT INTO sale_details (sale_id, item_id, nombre_producto, cantidad, precio_unitario, subtotal)
            VALUES ($1, $2, $3, $4, $5, $6)
        `;

        for (const item of items) {
            const prodId = item.item ? item.item.id : (item.item_id || item.id);
            const prodNombre = item.item ? item.item.nombre : (item.nombre_producto || item.nombre);

            await client.query(itemQuery, [
                saleId, 
                prodId, 
                prodNombre, 
                item.cantidad, 
                item.precioVenta, 
                item.subtotal
            ]);
        }

        // 4. REGISTRAR ABONO EN HISTORIAL
        if (metodo === 'CREDITO' && abono > 0) {
            await client.query(`
                INSERT INTO payment_history (sale_id, monto, metodo_pago, notas)
                VALUES ($1, $2, 'EFECTIVO', 'Abono Inicial')
            `, [saleId, abono]);
        }
        
        if (metodo !== 'CREDITO') {
             await client.query(`
                INSERT INTO payment_history (sale_id, monto, metodo_pago, notas)
                VALUES ($1, $2, $3, 'Pago al contado')
            `, [saleId, total, metodo]);
        }

        await client.query('COMMIT');
        
        res.status(201).json({ 
            message: 'Venta registrada', 
            saleId, 
            client_nombre: clientNombre 
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ ERROR REAL DEL BACKEND:', error);
        res.status(500).json({ error: 'Error al procesar la venta. Revisa la consola del servidor.' });
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
        const { rows } = await pool.query(
            `SELECT 
                s.id, s.total, s.metodo_pago, s.client_id,
                COALESCE(s.client_nombre, c.nombre) AS client_nombre,
                COALESCE(s.client_cedula, c.cedula) AS client_cedula,
                s.created_at,
                s.tax_rate
             FROM sales s
             LEFT JOIN clients c ON s.client_id = c.id
             WHERE s.created_at >= $1::timestamptz AND s.created_at <= $2::timestamptz
             ORDER BY s.created_at DESC`,
            [from, to]
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
            const { start: s, end: e } = getWeekRange(new Date());
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
                start = from;
                const toDate = new Date(to);
                toDate.setDate(toDate.getDate() + 1);
                end = toDate.toISOString().slice(0, 10);
            }
        } else {
            return res.status(400).json({ error: 'Proporciona period=month|year o from/to' });
        }

        const { rows } = await pool.query(
            `SELECT COUNT(*)::int AS count, COALESCE(SUM(total),0)::numeric AS total
             FROM sales
             WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz`,
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
            dateFilter = 'AND s.created_at >= $2::timestamptz AND s.created_at <= $3::timestamptz';
            params.push(from, to);
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
            dateFilter = 'AND s.created_at >= $2::timestamptz AND s.created_at <= $3::timestamptz';
            params.push(from, to);
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
            params.push(from, to);
            dateClause = "AND s.created_at >= $2::date AND s.created_at < ($3::date + INTERVAL '1 day')";
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
            WHERE s.estado_pago = 'PENDIENTE'
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
    const { saleId, monto, metodo_pago } = req.body; 

    try {
        // 👇 1. SEGURIDAD: VERIFICAR CAJA ABIERTA (Esto faltaba)
        const cajaCheck = await pool.query(
            "SELECT id FROM cash_registers WHERE estado = 'ABIERTA' LIMIT 1"
        );

        if (cajaCheck.rows.length === 0) {
            return res.status(403).json({ 
                error: '⛔ LA CAJA ESTÁ CERRADA. Abre turno para recibir abonos.' 
            });
        }
        // 👆 FIN SEGURIDAD

        if (!saleId || !monto) {
            return res.status(400).json({ error: 'Faltan datos' });
        }

        const metodo = metodo_pago || 'EFECTIVO'; 

        // Registrar Abono
        await pool.query(`
            INSERT INTO payment_history (sale_id, monto, metodo_pago, notas)
            VALUES ($1, $2, $3, 'Abono de Deuda')
        `, [saleId, monto, metodo]);

        // OJO: Aquí deberías tener también la lógica para restar el saldo de la venta (sales.saldo_pendiente),
        // pero asumo que eso lo manejas con un Trigger en la base de datos o en otra consulta. 
        // Si no tienes trigger, avísame para agregarlo aquí mismo.

        res.status(200).json({ message: 'Abono registrado correctamente' });

    } catch (error) {
        console.error('Error registrando abono:', error);
        res.status(500).json({ error: 'Error al registrar el pago' });
    }
};
