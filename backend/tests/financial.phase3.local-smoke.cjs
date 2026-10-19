const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
require('dotenv').config();
const { Client } = require('pg');
const { applyPayment, getMovementTotals } = require('../dist/services/financialIntegrity.service.js');

const url = new URL(process.env.DATABASE_URL || '');
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname.slice(1) !== 'poscarmitaVlocal') {
  throw new Error('Prueba bloqueada: requiere poscarmitaVlocal en localhost');
}

const client = new Client({ connectionString: process.env.DATABASE_URL });

(async () => {
  await client.connect();
  const openBefore = Number((await client.query(`SELECT COUNT(*) FROM cash_registers WHERE estado = 'ABIERTA'`)).rows[0].count);
  assert.equal(openBefore, 1, 'La prueba requiere conservar la unica caja local abierta');
  await client.query('BEGIN');
  try {
    const creditSaleId = randomUUID();
    await client.query(
      `INSERT INTO sales (id, total, tipo_pago, metodo_pago, estado_pago, saldo_pendiente, monto_pagado, total_pagado, operation_id)
       VALUES ($1, 100, 'CREDITO', 'CREDITO', 'PENDIENTE', 100, 0, 0, $2)`,
      [creditSaleId, randomUUID()]
    );
    const paymentOperation = randomUUID();
    const first = await applyPayment(client, { saleId: creditSaleId, amount: 30, method: 'EFECTIVO', operationId: paymentOperation });
    assert.deepEqual({ paid: first.paid, balance: first.balance, status: first.status }, { paid: 30, balance: 70, status: 'PARCIAL' });
    const repeated = await applyPayment(client, { saleId: creditSaleId, amount: 30, method: 'EFECTIVO', operationId: paymentOperation });
    assert.equal(repeated.idempotent, true);
    const stored = (await client.query(`SELECT monto_pagado, total_pagado, saldo_pendiente, estado_pago FROM sales WHERE id = $1`, [creditSaleId])).rows[0];
    assert.deepEqual([Number(stored.monto_pagado), Number(stored.total_pagado), Number(stored.saldo_pendiente), stored.estado_pago], [30, 30, 70, 'PARCIAL']);
    assert.equal(Number((await client.query(`SELECT COUNT(*) FROM payment_history WHERE operation_id = $1`, [paymentOperation])).rows[0].count), 1);

    const cashSaleId = randomUUID();
    await client.query(
      `INSERT INTO sales (id, fecha, created_at, total, tipo_pago, metodo_pago, estado_pago, saldo_pendiente, monto_pagado, total_pagado, operation_id)
       VALUES ($1, '2099-01-01T15:00:00Z', '2099-01-01T15:00:00Z', 100, 'EFECTIVO', 'EFECTIVO', 'PAGADO', 0, 100, 100, $2)`,
      [cashSaleId, randomUUID()]
    );
    await client.query(
      `INSERT INTO payment_history (sale_id, monto, metodo_pago, notas, fecha, created_at, operation_id)
       VALUES ($1, 100, 'EFECTIVO', 'Pago al contado', '2099-01-01T15:00:00Z', '2099-01-01T15:00:00Z', $2)`,
      [cashSaleId, randomUUID()]
    );
    await client.query(
      `INSERT INTO sales (id, fecha, created_at, total, tipo_pago, metodo_pago, estado_pago, saldo_pendiente, monto_pagado, total_pagado, operation_id)
       VALUES ($1, '2099-01-01T16:00:00Z', '2099-01-01T16:00:00Z', 50, 'TRANSFERENCIA', 'TRANSFERENCIA', 'PAGADO', 0, 50, 50, $2)`,
      [randomUUID(), randomUUID()]
    );
    await client.query(
      `INSERT INTO expenses (descripcion, monto, categoria, metodo_pago, fecha) VALUES ('Smoke Fase 3', 10, 'OTROS', 'EFECTIVO', '2099-01-01T17:00:00Z')`
    );
    const totals = await getMovementTotals(client, '2099-01-01T05:00:00Z', '2099-01-02T05:00:00Z');
    assert.deepEqual(
      { cash: totals.efectivo_ventas, digital: totals.digital_total, income: totals.total_ingresos, billed: totals.total_facturado, expense: totals.total_gastos },
      { cash: 100, digital: 50, income: 150, billed: 150, expense: 10 }
    );

    await client.query('SAVEPOINT opening');
    let duplicateOpenRejected = false;
    try {
      await client.query(`INSERT INTO cash_registers (monto_inicial, estado) VALUES (0, 'ABIERTA')`);
    } catch (error) {
      duplicateOpenRejected = error.code === '23505';
      await client.query('ROLLBACK TO SAVEPOINT opening');
    }
    assert.equal(duplicateOpenRejected, true, 'El indice debe impedir dos cajas abiertas');
  } finally {
    await client.query('ROLLBACK');
  }
  const openAfter = Number((await client.query(`SELECT COUNT(*) FROM cash_registers WHERE estado = 'ABIERTA'`)).rows[0].count);
  assert.equal(openAfter, openBefore, 'La caja abierta no fue modificada');
  const schema = `phase3_test_${randomUUID().replaceAll('-', '')}`;
  const second = new Client({ connectionString: process.env.DATABASE_URL });
  await second.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`
      CREATE TABLE ${schema}.sales (
        id uuid PRIMARY KEY, total numeric NOT NULL, saldo_pendiente numeric NOT NULL,
        monto_pagado numeric NOT NULL, total_pagado numeric NOT NULL, estado_pago text NOT NULL,
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE ${schema}.payment_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sale_id uuid NOT NULL REFERENCES ${schema}.sales(id),
        monto numeric NOT NULL, metodo_pago text NOT NULL, notas text, operation_id uuid UNIQUE, usuario_id uuid
      );
    `);
    await client.query(`SET search_path TO ${schema}`);
    await second.query(`SET search_path TO ${schema}`);
    const concurrentSale = randomUUID();
    await client.query(`INSERT INTO sales VALUES ($1, 100, 100, 0, 0, 'PENDIENTE', now())`, [concurrentSale]);
    await client.query('BEGIN');
    const accepted = await applyPayment(client, { saleId: concurrentSale, amount: 60, operationId: randomUUID() });
    const competing = (async () => {
      await second.query('BEGIN');
      try {
        return await applyPayment(second, { saleId: concurrentSale, amount: 60, operationId: randomUUID() });
      } catch (error) {
        await second.query('ROLLBACK');
        throw error;
      }
    })();
    await client.query('COMMIT');
    assert.equal(accepted.balance, 40);
    await assert.rejects(competing, (error) => error.status === 409);
    const concurrentStored = (await client.query(`SELECT monto_pagado, saldo_pendiente FROM sales WHERE id = $1`, [concurrentSale])).rows[0];
    assert.deepEqual([Number(concurrentStored.monto_pagado), Number(concurrentStored.saldo_pendiente)], [60, 40]);
    assert.equal(Number((await client.query(`SELECT COUNT(*) FROM payment_history WHERE sale_id = $1`, [concurrentSale])).rows[0].count), 1);
  } finally {
    await second.end();
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  console.log(JSON.stringify({ ok: true, openBefore, openAfter, rolledBack: true, concurrentPaymentsProtected: true }));
})().finally(() => client.end());
