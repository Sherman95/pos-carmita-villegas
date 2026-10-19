const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
require('dotenv').config();

const { applyPayment, getMovementTotals } = require('../dist/services/financialIntegrity.service.js');
const {
  enforceCashPolicyForFinancialOperation,
  getCashControlEnabled
} = require('../dist/services/cashControl.service.js');

(async () => {
  const configured = new URL(process.env.DATABASE_URL);
  const expectedDb = configured.pathname.replace(/^\//, '');
  if (!['localhost', '127.0.0.1', '::1'].includes(configured.hostname) || expectedDb.toLowerCase() !== 'poscarmitavlocal') {
    throw new Error('Smoke Fase 7 abortado: DATABASE_URL no apunta a poscarmitaVlocal en localhost');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const identity = (await client.query(
    'SELECT current_database() AS db, inet_server_addr()::text AS address'
  )).rows[0];
  assert.equal(String(identity.db).toLowerCase(), 'poscarmitavlocal');
  assert.match(String(identity.address), /^(::1\/128|127\.0\.0\.1\/32)$/);

  await client.query('BEGIN');
  try {
    await client.query(`
      CREATE TEMP TABLE business_config (
        config_key text PRIMARY KEY,
        config_value text,
        updated_at timestamptz DEFAULT now()
      ) ON COMMIT DROP;
      CREATE TEMP TABLE cash_registers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        fecha_apertura timestamptz NOT NULL DEFAULT now(),
        monto_inicial numeric NOT NULL DEFAULT 0,
        usuario_id uuid,
        estado text NOT NULL
      ) ON COMMIT DROP;
      CREATE TEMP TABLE sales (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        total numeric NOT NULL,
        saldo_pendiente numeric DEFAULT 0,
        monto_pagado numeric DEFAULT 0,
        total_pagado numeric DEFAULT 0,
        estado_pago text DEFAULT 'PENDIENTE',
        tipo_pago text DEFAULT 'CREDITO',
        metodo_pago text DEFAULT 'CREDITO',
        usuario_id uuid,
        fecha timestamptz DEFAULT now(),
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      ) ON COMMIT DROP;
      CREATE TEMP TABLE payment_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        sale_id uuid NOT NULL,
        monto numeric NOT NULL CHECK (monto > 0),
        metodo_pago text DEFAULT 'EFECTIVO',
        notas text,
        usuario_id uuid,
        operation_id uuid UNIQUE,
        fecha timestamptz DEFAULT now(),
        created_at timestamptz DEFAULT now()
      ) ON COMMIT DROP;
      CREATE TEMP TABLE expenses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        monto numeric NOT NULL,
        categoria text NOT NULL,
        descripcion text,
        metodo_pago text DEFAULT 'EFECTIVO',
        usuario_id uuid,
        fecha timestamptz DEFAULT now()
      ) ON COMMIT DROP;
    `);

    await client.query(`INSERT INTO business_config(config_key, config_value) VALUES ('cash_control_enabled', 'false')`);
    assert.equal(await getCashControlEnabled(client), false);
    assert.equal(await enforceCashPolicyForFinancialOperation(client), false);
    assert.equal(Number((await client.query(`SELECT COUNT(*) FROM cash_registers`)).rows[0].count), 0);

    const saleId = randomUUID();
    await client.query(
      `INSERT INTO sales(id,total,saldo_pendiente,monto_pagado,total_pagado,estado_pago,tipo_pago,metodo_pago)
       VALUES ($1,100,100,0,0,'PENDIENTE','CREDITO','CREDITO')`,
      [saleId]
    );
    const firstOperation = randomUUID();
    const actorId = randomUUID();
    const first = await applyPayment(client, { saleId, amount: 30, method: 'EFECTIVO', operationId: firstOperation, userId: actorId });
    assert.equal(first.paid, 30);
    assert.equal(first.balance, 70);
    assert.equal(first.status, 'PARCIAL');

    const duplicate = await applyPayment(client, { saleId, amount: 30, method: 'EFECTIVO', operationId: firstOperation, userId: actorId });
    assert.equal(duplicate.idempotent, true);
    assert.equal(Number((await client.query(`SELECT COUNT(*) FROM payment_history WHERE operation_id=$1`, [firstOperation])).rows[0].count), 1);

    const second = await applyPayment(client, { saleId, amount: 70, method: 'TRANSFERENCIA', operationId: randomUUID(), userId: actorId });
    assert.equal(second.paid, 100);
    assert.equal(second.balance, 0);
    assert.equal(second.status, 'PAGADO');
    const finalSale = (await client.query(`SELECT monto_pagado,saldo_pendiente,estado_pago FROM sales WHERE id=$1`, [saleId])).rows[0];
    assert.equal(Number(finalSale.monto_pagado), 100);
    assert.equal(Number(finalSale.saldo_pendiente), 0);
    assert.equal(finalSale.estado_pago, 'PAGADO');
    assert.equal(Number((await client.query(`SELECT COUNT(*) FROM payment_history WHERE sale_id=$1 AND usuario_id=$2`, [saleId, actorId])).rows[0].count), 2);

    const pendingSale = randomUUID();
    await client.query(
      `INSERT INTO sales(id,total,saldo_pendiente,monto_pagado,total_pagado,estado_pago,tipo_pago,metodo_pago)
       VALUES ($1,50,50,0,0,'PENDIENTE','CREDITO','CREDITO')`,
      [pendingSale]
    );
    await assert.rejects(
      () => applyPayment(client, { saleId: pendingSale, amount: 51, method: 'EFECTIVO', operationId: randomUUID() }),
      /supera el saldo pendiente/i
    );

    await client.query(
      `INSERT INTO expenses(monto,categoria,descripcion,metodo_pago,usuario_id)
       VALUES (12.50,'PRUEBA_FASE7','Gasto temporal rollback','EFECTIVO',$1)`,
      [randomUUID()]
    );
    const start = new Date(Date.now() - 60_000);
    const end = new Date(Date.now() + 60_000);
    const totals = await getMovementTotals(client, start, end);
    assert.equal(totals.total_ingresos, 100);
    assert.equal(totals.total_gastos, 12.5);
    assert.equal(totals.gastos_efectivo, 12.5);

    await client.query(`UPDATE business_config SET config_value='true' WHERE config_key='cash_control_enabled'`);
    await assert.rejects(() => enforceCashPolicyForFinancialOperation(client), /CAJA ESTA CERRADA/i);
    await client.query(`INSERT INTO cash_registers(monto_inicial,estado) VALUES (20,'ABIERTA')`);
    assert.equal(await enforceCashPolicyForFinancialOperation(client), true);

    console.log('Smoke Fase 7 OK: configuración, caja, abonos, saldos, idempotencia, sobrepago, gastos y reportes.');
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

