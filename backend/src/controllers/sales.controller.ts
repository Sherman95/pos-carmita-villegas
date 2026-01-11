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

export const createSale = async (req: Request, res: Response) => {
    // Obtenemos un cliente del pool para iniciar una transacción
    const client = await pool.connect();

    try {
        // Recibimos más datos según tu tabla 'sales'
        const { total, items, metodo_pago, client_id } = req.body;

        let clientNombre: string | null = null;
        let clientCedula: string | null = null;

        if (client_id) {
            const { rows } = await client.query('SELECT nombre, cedula FROM clients WHERE id = $1', [client_id]);
            if (rows.length === 0) {
                return res.status(400).json({ error: 'Cliente no encontrado' });
            }
            clientNombre = rows[0].nombre;
            clientCedula = rows[0].cedula || null;
        }

        // 1. INICIAR TRANSACCIÓN
        await client.query('BEGIN');

        // 2. INSERTAR CABECERA (Tabla 'sales')
        const saleQuery = `
            INSERT INTO sales (total, metodo_pago, client_id, client_nombre, client_cedula) 
            VALUES ($1, $2, $3, $4, $5) 
            RETURNING id
        `;
        const saleValues = [total, metodo_pago || 'EFECTIVO', client_id || null, clientNombre, clientCedula];
        const saleResult = await client.query(saleQuery, saleValues);
        const saleId = saleResult.rows[0].id;

        // 3. INSERTAR DETALLES (Tabla 'sale_details')
        const itemQuery = `
            INSERT INTO sale_details (sale_id, item_id, nombre_producto, cantidad, precio_unitario, subtotal)
            VALUES ($1, $2, $3, $4, $5, $6)
        `;

        for (const item of items) {
            await client.query(itemQuery, [
                saleId, 
                item.item.id,       // ID del producto (FK)
                item.item.nombre,   // Snapshot nombre
                item.cantidad, 
                item.precioVenta,   // Precio final
                item.subtotal
            ]);
        }

        // 4. CONFIRMAR TRANSACCIÓN
        await client.query('COMMIT');

        console.log(`✅ Venta creada ID: ${saleId}`);
        res.status(201).json({ message: 'Venta registrada', saleId, client_nombre: clientNombre, client_cedula: clientCedula });

    } catch (error) {
        // Si falla, deshacemos todo
        await client.query('ROLLBACK');
        console.error('Error creando venta:', error);
        res.status(500).json({ error: 'Error al procesar la venta' });
    } finally {
        client.release(); // Liberamos la conexión
    }
};

export const getSales = async (_req: Request, res: Response) => {
    try {
        const { rows } = await pool.query(
            `SELECT 
                s.id, s.total, s.metodo_pago, s.client_id, 
                COALESCE(s.client_nombre, c.nombre) AS client_nombre,
                COALESCE(s.client_cedula, c.cedula) AS client_cedula,
                s.created_at
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
        return res.status(400).json({ error: 'from y to son requeridos (YYYY-MM-DD)' });
    }

    try {
        const { rows } = await pool.query(
            `SELECT 
                s.id, s.total, s.metodo_pago, s.client_id,
                COALESCE(s.client_nombre, c.nombre) AS client_nombre,
                COALESCE(s.client_cedula, c.cedula) AS client_cedula,
                s.created_at
             FROM sales s
             LEFT JOIN clients c ON s.client_id = c.id
             WHERE s.created_at >= $1::date AND s.created_at < ($2::date + INTERVAL '1 day')
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
            start = from;
            const toDate = new Date(to);
            toDate.setDate(toDate.getDate() + 1);
            end = toDate.toISOString().slice(0, 10);
        } else {
            return res.status(400).json({ error: 'Proporciona period=month|year o from/to' });
        }

        const { rows } = await pool.query(
            `SELECT COUNT(*)::int AS count, COALESCE(SUM(total),0)::numeric AS total
             FROM sales
             WHERE created_at >= $1::date AND created_at < $2::date`,
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
    const { from, to, period } = req.query as { from?: string; to?: string; period?: string };
    if (!clientId) {
        return res.status(400).json({ error: 'clientId requerido' });
    }

    let start = from;
    let end = to;

    if (period === 'week') {
        const rng = getWeekRange(new Date());
        start = rng.start;
        end = rng.end;
    }

    try {
        const detailQuery = `
            SELECT 
                s.id, s.total, s.metodo_pago, s.client_id,
                COALESCE(s.client_nombre, c.nombre) AS client_nombre,
                COALESCE(s.client_cedula, c.cedula) AS client_cedula,
                s.created_at
            FROM sales s
            LEFT JOIN clients c ON s.client_id = c.id
            WHERE s.client_id = $1
            ${start && end ? 'AND s.created_at >= $2::date AND s.created_at < $3::date' : ''}
            ORDER BY s.created_at DESC
        `;
        const summarySql = `
            SELECT COUNT(*)::int AS count, COALESCE(SUM(total),0)::numeric AS total
            FROM sales
            WHERE client_id = $1
            ${start && end ? 'AND created_at >= $2::date AND created_at < $3::date' : ''}
        `;

        const params = start && end ? [clientId, start, end] : [clientId];
        const [detailResult, summaryResult] = await Promise.all([
            pool.query(detailQuery, params),
            pool.query(summarySql, params)
        ]);

        res.status(200).json({
            sales: detailResult.rows,
            summary: summaryResult.rows[0]
        });
    } catch (error) {
        console.error('Error obteniendo ventas por cliente:', error);
        res.status(500).json({ error: 'Error al obtener ventas por cliente' });
    }
};

export const getSalesByItem = async (req: Request, res: Response) => {
    const { itemId } = req.params;
    const { from, to, period } = req.query as { from?: string; to?: string; period?: string };
    if (!itemId) return res.status(400).json({ error: 'itemId requerido' });

    let start = from;
    let end = to;
    if (period === 'week') {
        const rng = getWeekRange(new Date());
        start = rng.start;
        end = rng.end;
    }

    try {
        const detailQuery = `
            SELECT 
                s.id AS sale_id,
                s.created_at,
                s.metodo_pago,
                COALESCE(s.client_nombre, c.nombre) AS client_nombre,
                COALESCE(s.client_cedula, c.cedula) AS client_cedula,
                sd.nombre_producto,
                sd.cantidad,
                sd.precio_unitario,
                sd.subtotal
            FROM sale_details sd
            JOIN sales s ON sd.sale_id = s.id
            LEFT JOIN clients c ON s.client_id = c.id
            WHERE sd.item_id = $1
            ${start && end ? 'AND s.created_at >= $2::date AND s.created_at < $3::date' : ''}
            ORDER BY s.created_at DESC
        `;

        const summarySql = `
            SELECT COUNT(*)::int AS count, COALESCE(SUM(sd.subtotal),0)::numeric AS total
            FROM sale_details sd
            JOIN sales s ON sd.sale_id = s.id
            WHERE sd.item_id = $1
            ${start && end ? 'AND s.created_at >= $2::date AND s.created_at < $3::date' : ''}
        `;

        const params = start && end ? [itemId, start, end] : [itemId];
        const [detailResult, summaryResult] = await Promise.all([
            pool.query(detailQuery, params),
            pool.query(summarySql, params)
        ]);

        res.status(200).json({
            sales: detailResult.rows,
            summary: summaryResult.rows[0]
        });
    } catch (error) {
        console.error('Error obteniendo ventas por servicio:', error);
        res.status(500).json({ error: 'Error al obtener ventas por servicio' });
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
                s.created_at
            FROM sales s
            LEFT JOIN clients c ON s.client_id = c.id
            WHERE s.id = $1
        `;

        const detailQuery = `
            SELECT 
                sd.id,
                sd.nombre_producto,
                sd.cantidad,
                sd.precio_unitario,
                sd.subtotal
            FROM sale_details sd
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

export const saveSaleReceipt = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { pdfBase64, docType } = req.body as { pdfBase64?: string; docType?: string };

    if (!id) return res.status(400).json({ error: 'id requerido' });
    if (!pdfBase64 || typeof pdfBase64 !== 'string') {
        return res.status(400).json({ error: 'pdfBase64 requerido' });
    }

    const kind = docType && typeof docType === 'string' ? docType : 'receipt';

    try {
        // Verificar que exista la venta
        const saleExists = await pool.query('SELECT 1 FROM sales WHERE id = $1', [id]);
        if (saleExists.rowCount === 0) {
            return res.status(404).json({ error: 'Venta no encontrada' });
        }

        // Insertar recibo (se guarda la cadena base64 del PDF)
        const insertSql = `
            INSERT INTO sale_receipts (sale_id, pdf_base64, doc_type)
            VALUES ($1, $2, $3)
            RETURNING id, created_at, doc_type
        `;
        const { rows } = await pool.query(insertSql, [id, pdfBase64, kind]);

        res.status(201).json({ receiptId: rows[0].id, created_at: rows[0].created_at, doc_type: rows[0].doc_type });
    } catch (error) {
        console.error('Error guardando recibo:', error);
        res.status(500).json({ error: 'Error al guardar recibo' });
    }
};

// =================================================================================
// FUNCIÓN CORREGIDA: Devuelve un Buffer (Archivo) en lugar de JSON
// =================================================================================
export const getSaleReceipt = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { docType } = req.query as { docType?: string };
    
    if (!id) return res.status(400).json({ error: 'id requerido' });

    try {
        const params: any[] = [id];
        let clause = '';
        if (docType) {
            clause = 'AND doc_type = $2';
            params.push(docType);
        }

        const { rows } = await pool.query(
            `SELECT pdf_base64, created_at, doc_type
             FROM sale_receipts
             WHERE sale_id = $1
             ${clause}
             ORDER BY created_at DESC
             LIMIT 1`,
            params
        );

        // Si no hay recibo, devolvemos 404
        if (rows.length === 0) {
             console.warn(`[getSaleReceipt] No hay recibo para venta ID: ${id}`);
             return res.status(404).json({ error: 'Recibo no encontrado. Puede que no se haya generado aún.' });
        }

        const record = rows[0];

        // --- CORRECCIÓN CLAVE ---
        // Convertimos el string base64 almacenado en la DB a un Buffer binario
        const pdfBuffer = Buffer.from(record.pdf_base64, 'base64');

        // Configuramos los headers para que el navegador sepa que es un PDF
        res.setHeader('Content-Type', 'application/pdf');
        // 'inline' abre el PDF en el navegador. 
        res.setHeader('Content-Disposition', `inline; filename="recibo-${id}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);

        // Enviamos el archivo
        res.send(pdfBuffer);

    } catch (error) {
        console.error('Error obteniendo recibo:', error);
        res.status(500).json({ error: 'Error interno al obtener recibo' });
    }
};

export const getReceiptsByClient = async (req: Request, res: Response) => {
    const { clientId } = req.params;
    const { from, to, docType } = req.query as { from?: string; to?: string; docType?: string };
    if (!clientId) return res.status(400).json({ error: 'clientId requerido' });

    try {
        const params: any[] = [clientId];
        let dateClause = '';
        if (from && to) {
            params.push(from, to);
            dateClause = "AND s.created_at >= $2::date AND s.created_at < ($3::date + INTERVAL '1 day')";
        }

        const typeClause = docType ? 'AND sr.doc_type = $' + (params.length + 1) : '';
        if (docType) params.push(docType);

        const { rows } = await pool.query(
            `SELECT sr.id AS receipt_id, sr.sale_id, sr.created_at AS receipt_created_at,
                    s.total, s.metodo_pago,
                    COALESCE(s.client_nombre, c.nombre) AS client_nombre,
                    COALESCE(s.client_cedula, c.cedula) AS client_cedula,
                    s.created_at AS sale_created_at,
                    sr.doc_type
             FROM sale_receipts sr
             JOIN sales s ON sr.sale_id = s.id
             LEFT JOIN clients c ON s.client_id = c.id
             WHERE s.client_id = $1
             ${dateClause}
             ${typeClause}
             ORDER BY sr.created_at DESC`,
            params
        );

        res.status(200).json(rows);
    } catch (error) {
        console.error('Error obteniendo recibos por cliente:', error);
        res.status(500).json({ error: 'Error al obtener recibos por cliente' });
    }
};
