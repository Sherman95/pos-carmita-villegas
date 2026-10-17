import { PoolClient } from 'pg';

export const SUPPORTED_RECEIPT_METHODS = ['EFECTIVO', 'TRANSFERENCIA'] as const;
export type ReceiptMethod = typeof SUPPORTED_RECEIPT_METHODS[number];

export class FinancialError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const toCents = (value: unknown, field = 'monto'): number => {
    if (value === '' || value === null || value === undefined) {
        throw new FinancialError(400, `${field} es obligatorio`);
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new FinancialError(400, `${field} no es valido`);
    const cents = Math.round(numeric * 100);
    if (Math.abs(numeric - cents / 100) > 0.000001) {
        throw new FinancialError(400, `${field} admite maximo dos decimales`);
    }
    return cents;
};

export const fromCents = (cents: number): number => Number((cents / 100).toFixed(2));

export const parseReceiptMethod = (value: unknown, fallback: ReceiptMethod = 'EFECTIVO'): ReceiptMethod => {
    const method = String(value || fallback).trim().toUpperCase();
    if (!SUPPORTED_RECEIPT_METHODS.includes(method as ReceiptMethod)) {
        throw new FinancialError(400, 'Metodo de pago no soportado');
    }
    return method as ReceiptMethod;
};

export const requireUuid = (value: unknown, field: string): string => {
    const normalized = String(value || '').trim();
    if (!UUID_PATTERN.test(normalized)) throw new FinancialError(400, `${field} no es valido`);
    return normalized;
};

export const requireOpenRegister = async (client: PoolClient) => {
    const result = await client.query(
        `SELECT id, fecha_apertura, monto_inicial, usuario_id
         FROM cash_registers
         WHERE estado = 'ABIERTA'
         ORDER BY fecha_apertura DESC
         LIMIT 1
         FOR SHARE`
    );
    if (!result.rows[0]) {
        throw new FinancialError(403, 'LA CAJA ESTA CERRADA. Abre turno para continuar.');
    }
    return result.rows[0];
};

export interface MovementTotals {
    efectivo_ventas: number;
    efectivo_abonos: number;
    digital_total: number;
    total_ingresos: number;
    total_facturado: number;
    credito_pendiente: number;
    gastos_efectivo: number;
    gastos_digital: number;
    total_gastos: number;
}

export const getMovementTotals = async (
    client: Pick<PoolClient, 'query'>,
    start: string | Date,
    end: string | Date
): Promise<MovementTotals> => {
    const result = await client.query(`
        WITH recorded_receipts AS (
            SELECT ph.sale_id,
                   ph.monto::numeric AS monto,
                   UPPER(COALESCE(ph.metodo_pago, 'EFECTIVO')) AS metodo,
                   COALESCE(ph.fecha, ph.created_at) AS occurred_at,
                   CASE WHEN UPPER(COALESCE(s.tipo_pago, s.metodo_pago, 'EFECTIVO')) = 'CREDITO'
                        THEN 'ABONO' ELSE 'VENTA' END AS clase
            FROM payment_history ph
            JOIN sales s ON s.id = ph.sale_id
            WHERE COALESCE(ph.fecha, ph.created_at) >= $1::timestamptz
              AND COALESCE(ph.fecha, ph.created_at) < $2::timestamptz
        ),
        legacy_receipts AS (
            SELECT s.id AS sale_id,
                   LEAST(
                       GREATEST(COALESCE(NULLIF(s.total_pagado, 0), NULLIF(s.monto_pagado, 0),
                           CASE WHEN UPPER(COALESCE(s.tipo_pago, s.metodo_pago, 'EFECTIVO')) <> 'CREDITO'
                                THEN s.total ELSE 0 END), 0),
                       s.total
                   )::numeric AS monto,
                   CASE WHEN UPPER(COALESCE(s.tipo_pago, s.metodo_pago, 'EFECTIVO')) = 'TRANSFERENCIA'
                        THEN 'TRANSFERENCIA' ELSE 'EFECTIVO' END AS metodo,
                   COALESCE(s.fecha, s.created_at) AS occurred_at,
                   CASE WHEN UPPER(COALESCE(s.tipo_pago, s.metodo_pago, 'EFECTIVO')) = 'CREDITO'
                        THEN 'ABONO' ELSE 'VENTA' END AS clase
            FROM sales s
            WHERE COALESCE(s.fecha, s.created_at) >= $1::timestamptz
              AND COALESCE(s.fecha, s.created_at) < $2::timestamptz
              AND NOT EXISTS (SELECT 1 FROM payment_history ph WHERE ph.sale_id = s.id)
        ),
        receipts AS (
            SELECT monto, metodo, clase FROM recorded_receipts
            UNION ALL
            SELECT monto, metodo, clase FROM legacy_receipts WHERE monto > 0
        ),
        receipt_totals AS (
            SELECT
                COALESCE(SUM(monto) FILTER (WHERE metodo = 'EFECTIVO' AND clase = 'VENTA'), 0) AS efectivo_ventas,
                COALESCE(SUM(monto) FILTER (WHERE metodo = 'EFECTIVO' AND clase = 'ABONO'), 0) AS efectivo_abonos,
                COALESCE(SUM(monto) FILTER (WHERE metodo = 'TRANSFERENCIA'), 0) AS digital_total,
                COALESCE(SUM(monto), 0) AS total_ingresos
            FROM receipts
        ),
        sale_totals AS (
            SELECT COALESCE(SUM(total), 0) AS total_facturado,
                   COALESCE(SUM(saldo_pendiente) FILTER (
                       WHERE UPPER(COALESCE(tipo_pago, metodo_pago, 'EFECTIVO')) = 'CREDITO'
                   ), 0) AS credito_pendiente
            FROM sales
            WHERE COALESCE(fecha, created_at) >= $1::timestamptz
              AND COALESCE(fecha, created_at) < $2::timestamptz
        ),
        expense_totals AS (
            SELECT COALESCE(SUM(monto) FILTER (WHERE UPPER(COALESCE(metodo_pago, 'EFECTIVO')) = 'EFECTIVO'), 0) AS gastos_efectivo,
                   COALESCE(SUM(monto) FILTER (WHERE UPPER(COALESCE(metodo_pago, 'EFECTIVO')) = 'TRANSFERENCIA'), 0) AS gastos_digital,
                   COALESCE(SUM(monto), 0) AS total_gastos
            FROM expenses
            WHERE fecha >= $1::timestamptz AND fecha < $2::timestamptz
        )
        SELECT * FROM receipt_totals CROSS JOIN sale_totals CROSS JOIN expense_totals
    `, [start, end]);
    const row = result.rows[0];
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)])) as unknown as MovementTotals;
};

export interface PaymentInput {
    saleId: string;
    amount: unknown;
    method?: unknown;
    operationId: string;
}

export const applyPayment = async (client: PoolClient, input: PaymentInput) => {
    const saleId = requireUuid(input.saleId, 'saleId');
    const operationId = requireUuid(input.operationId, 'operation_id');
    const amountCents = toCents(input.amount, 'monto');
    if (amountCents <= 0) throw new FinancialError(400, 'El abono debe ser mayor que cero');
    const method = parseReceiptMethod(input.method);

    const duplicate = await client.query(
        `SELECT sale_id, monto, metodo_pago FROM payment_history WHERE operation_id = $1 LIMIT 1`,
        [operationId]
    );
    if (duplicate.rows[0]) {
        const row = duplicate.rows[0];
        if (String(row.sale_id) !== saleId || toCents(row.monto) !== amountCents || parseReceiptMethod(row.metodo_pago) !== method) {
            throw new FinancialError(409, 'La clave de operacion ya fue utilizada con otros datos');
        }
        return { idempotent: true, saleId, paid: null, balance: null, status: null };
    }

    const saleResult = await client.query(
        `SELECT id, total, saldo_pendiente, monto_pagado, total_pagado, estado_pago
         FROM sales WHERE id = $1 FOR UPDATE`,
        [saleId]
    );
    const sale = saleResult.rows[0];
    if (!sale) throw new FinancialError(404, 'Venta no encontrada');

    const totalCents = toCents(sale.total, 'total');
    const paidCandidates = [sale.monto_pagado, sale.total_pagado, fromCents(totalCents - toCents(sale.saldo_pendiente ?? sale.total))]
        .map((value) => Math.max(0, toCents(value ?? 0)));
    const paidCents = Math.min(totalCents, Math.max(...paidCandidates));
    const balanceCents = totalCents - paidCents;
    if (balanceCents <= 0 || String(sale.estado_pago).toUpperCase() === 'PAGADO') {
        throw new FinancialError(409, 'La venta ya esta pagada');
    }
    if (amountCents > balanceCents) {
        throw new FinancialError(409, `El abono supera el saldo pendiente de $${fromCents(balanceCents).toFixed(2)}`);
    }

    const newPaidCents = paidCents + amountCents;
    const newBalanceCents = totalCents - newPaidCents;
    const status = newBalanceCents === 0 ? 'PAGADO' : 'PARCIAL';

    await client.query(
        `INSERT INTO payment_history (sale_id, monto, metodo_pago, notas, operation_id)
         VALUES ($1, $2, $3, 'Abono de Deuda', $4)`,
        [saleId, fromCents(amountCents), method, operationId]
    );
    await client.query(
        `UPDATE sales
         SET monto_pagado = $1, total_pagado = $1, saldo_pendiente = $2, estado_pago = $3, updated_at = NOW()
         WHERE id = $4`,
        [fromCents(newPaidCents), fromCents(newBalanceCents), status, saleId]
    );
    return {
        idempotent: false,
        saleId,
        paid: fromCents(newPaidCents),
        balance: fromCents(newBalanceCents),
        status
    };
};
