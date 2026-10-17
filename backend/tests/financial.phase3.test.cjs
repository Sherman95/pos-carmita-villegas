const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET ||= 'phase3-test-secret-with-at-least-32-characters';

const finance = require('../dist/services/financialIntegrity.service.js');
const time = require('../dist/utils/businessTime.js');

const UUID = '11111111-1111-4111-8111-111111111111';
const OP = '22222222-2222-4222-8222-222222222222';

class PaymentClient {
  constructor({ duplicate = null, sale = null } = {}) {
    this.duplicate = duplicate;
    this.sale = sale;
    this.calls = [];
  }
  async query(sql, params = []) {
    this.calls.push({ sql: String(sql), params });
    if (String(sql).includes('WHERE operation_id')) return { rows: this.duplicate ? [this.duplicate] : [] };
    if (String(sql).includes('FROM sales WHERE id')) return { rows: this.sale ? [this.sale] : [] };
    return { rows: [] };
  }
}

const sale = (overrides = {}) => ({
  id: UUID, total: '100.00', saldo_pendiente: '100.00', monto_pagado: '0.00',
  total_pagado: '0.00', estado_pago: 'PENDIENTE', ...overrides
});

test('01 convierte dinero exacto a centavos', () => assert.equal(finance.toCents('12.34'), 1234));
test('02 conserva cero como valor monetario valido', () => assert.equal(finance.toCents(0), 0));
test('03 rechaza NaN', () => assert.throws(() => finance.toCents('abc'), /no es valido/));
test('04 rechaza mas de dos decimales', () => assert.throws(() => finance.toCents(1.234), /dos decimales/));
test('05 convierte centavos sin ruido binario', () => assert.equal(finance.fromCents(1234), 12.34));
test('06 metodo predeterminado es efectivo', () => assert.equal(finance.parseReceiptMethod(), 'EFECTIVO'));
test('07 normaliza transferencia', () => assert.equal(finance.parseReceiptMethod(' transferencia '), 'TRANSFERENCIA'));
test('08 rechaza metodos no soportados', () => assert.throws(() => finance.parseReceiptMethod('CHEQUE'), /no soportado/));
test('09 acepta UUID valido', () => assert.equal(finance.requireUuid(UUID, 'id'), UUID));
test('10 rechaza UUID invalido', () => assert.throws(() => finance.requireUuid('1', 'id'), /no es valido/));
test('11 dia Ecuador inicia a las 05:00 UTC', () => assert.deepEqual(time.getBusinessDateRange('2026-10-17'), { start: '2026-10-17T05:00:00.000Z', end: '2026-10-18T05:00:00.000Z' }));
test('12 rango Ecuador incluye completo el ultimo dia', () => assert.equal(time.getBusinessDateRange('2026-10-16', '2026-10-17').end, '2026-10-18T05:00:00.000Z'));
test('13 rango invertido se rechaza', () => assert.throws(() => time.getBusinessDateRange('2026-10-18', '2026-10-17'), /rango/));
test('14 abono exige identificador de operacion', async () => assert.rejects(() => finance.applyPayment(new PaymentClient(), { saleId: UUID, amount: 1, operationId: '' }), /operation_id/));
test('15 abono cero se rechaza', async () => assert.rejects(() => finance.applyPayment(new PaymentClient(), { saleId: UUID, amount: 0, operationId: OP }), /mayor que cero/));
test('16 abono negativo se rechaza', async () => assert.rejects(() => finance.applyPayment(new PaymentClient(), { saleId: UUID, amount: -1, operationId: OP }), /mayor que cero/));
test('17 abono con metodo desconocido se rechaza', async () => assert.rejects(() => finance.applyPayment(new PaymentClient(), { saleId: UUID, amount: 1, method: 'CHEQUE', operationId: OP }), /no soportado/));
test('18 venta inexistente devuelve 404 financiero', async () => {
  await assert.rejects(() => finance.applyPayment(new PaymentClient(), { saleId: UUID, amount: 1, operationId: OP }), (e) => e.status === 404);
});
test('19 venta pagada no recibe otro abono', async () => {
  const client = new PaymentClient({ sale: sale({ saldo_pendiente: 0, monto_pagado: 100, total_pagado: 100, estado_pago: 'PAGADO' }) });
  await assert.rejects(() => finance.applyPayment(client, { saleId: UUID, amount: 1, operationId: OP }), (e) => e.status === 409);
});
test('20 sobrepago se rechaza', async () => {
  const client = new PaymentClient({ sale: sale() });
  await assert.rejects(() => finance.applyPayment(client, { saleId: UUID, amount: 100.01, operationId: OP }), /supera el saldo/);
});
test('21 credito sin inicial: abono 30 deja pagado 30 y saldo 70', async () => {
  const result = await finance.applyPayment(new PaymentClient({ sale: sale() }), { saleId: UUID, amount: 30, operationId: OP });
  assert.deepEqual({ paid: result.paid, balance: result.balance, status: result.status }, { paid: 30, balance: 70, status: 'PARCIAL' });
});
test('22 credito con inicial 20: abono 30 acumula 50', async () => {
  const result = await finance.applyPayment(new PaymentClient({ sale: sale({ saldo_pendiente: 80, monto_pagado: 20, total_pagado: 20 }) }), { saleId: UUID, amount: 30, operationId: OP });
  assert.deepEqual({ paid: result.paid, balance: result.balance }, { paid: 50, balance: 50 });
});
test('23 pago total cambia estado a PAGADO', async () => {
  const result = await finance.applyPayment(new PaymentClient({ sale: sale({ saldo_pendiente: 30, monto_pagado: 70, total_pagado: 70, estado_pago: 'PARCIAL' }) }), { saleId: UUID, amount: 30, operationId: OP });
  assert.deepEqual({ balance: result.balance, status: result.status }, { balance: 0, status: 'PAGADO' });
});
test('24 clave repetida con mismos datos es idempotente', async () => {
  const client = new PaymentClient({ duplicate: { sale_id: UUID, monto: 30, metodo_pago: 'EFECTIVO' } });
  const result = await finance.applyPayment(client, { saleId: UUID, amount: 30, operationId: OP });
  assert.equal(result.idempotent, true);
  assert.equal(client.calls.length, 1);
});
test('25 clave repetida con importe distinto devuelve conflicto', async () => {
  const client = new PaymentClient({ duplicate: { sale_id: UUID, monto: 20, metodo_pago: 'EFECTIVO' } });
  await assert.rejects(() => finance.applyPayment(client, { saleId: UUID, amount: 30, operationId: OP }), (e) => e.status === 409);
});
test('26 la venta se bloquea FOR UPDATE antes de modificar saldo', async () => {
  const client = new PaymentClient({ sale: sale() });
  await finance.applyPayment(client, { saleId: UUID, amount: 10, operationId: OP });
  assert.match(client.calls[1].sql, /FOR UPDATE/);
});
test('27 el movimiento se inserta antes de actualizar acumulados', async () => {
  const client = new PaymentClient({ sale: sale() });
  await finance.applyPayment(client, { saleId: UUID, amount: 10, operationId: OP });
  assert.ok(client.calls.findIndex(c => /INSERT INTO payment_history/.test(c.sql)) < client.calls.findIndex(c => /UPDATE sales/.test(c.sql)));
});
test('28 actualiza monto_pagado, total_pagado, saldo y estado juntos', async () => {
  const client = new PaymentClient({ sale: sale() });
  await finance.applyPayment(client, { saleId: UUID, amount: 10, operationId: OP });
  assert.match(client.calls.find(c => /UPDATE sales/.test(c.sql)).sql, /monto_pagado = \$1, total_pagado = \$1, saldo_pendiente = \$2, estado_pago = \$3/);
});
test('29 agregador convierte resultados PostgreSQL a numeros', async () => {
  const fake = { query: async (sql) => ({ rows: [{ efectivo_ventas: '10', efectivo_abonos: '5', digital_total: '7', total_ingresos: '22', total_facturado: '30', credito_pendiente: '8', gastos_efectivo: '2', gastos_digital: '1', total_gastos: '3' }] }) };
  const totals = await finance.getMovementTotals(fake, new Date(0), new Date(1));
  assert.equal(totals.total_ingresos, 22);
  assert.equal(totals.total_gastos, 3);
});
test('30 agregador evita duplicar ventas con historial y conserva legado', async () => {
  let sqlText = '';
  const fake = { query: async (sql) => { sqlText = String(sql); return { rows: [{ efectivo_ventas: 0, efectivo_abonos: 0, digital_total: 0, total_ingresos: 0, total_facturado: 0, credito_pendiente: 0, gastos_efectivo: 0, gastos_digital: 0, total_gastos: 0 }] }; } };
  await finance.getMovementTotals(fake, new Date(0), new Date(1));
  assert.match(sqlText, /NOT EXISTS \(SELECT 1 FROM payment_history/);
  assert.match(sqlText, /UNION ALL/);
});
test('31 migracion crea idempotencia y una sola caja abierta', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'financial_integrity_phase3.sql'), 'utf8');
  assert.match(sql, /uq_payment_history_operation_id/);
  assert.match(sql, /uq_cash_register_single_open/);
});
test('32 rutas de caja mantienen identidad POS obligatoria', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'cash.routes.ts'), 'utf8');
  assert.match(source, /router\.use\(verifyToken, requireStaff\)/);
});
test('33 gastos mantienen autorizacion administrativa de Fase 1', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'expenses.routes.ts'), 'utf8');
  assert.match(source, /router\.use\(verifyToken, requireStaff, requireAdmin\)/);
});
test('34 cierre ignora totales financieros enviados por el navegador', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'cashIntegrity.controller.ts'), 'utf8');
  assert.doesNotMatch(source, /req\.body\?\.total_ventas|req\.body\?\.monto_esperado/);
  assert.match(source, /buildClosingDetails\(client, session, closeTime\)/);
});
test('35 cierre bloquea la sesion y solo actualiza una caja abierta', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'cashIntegrity.controller.ts'), 'utf8');
  assert.match(source, /WHERE id = \$1 FOR UPDATE/);
  assert.match(source, /WHERE id = \$8 AND estado = 'ABIERTA'/);
});
test('36 apertura concurrente usa bloqueo asesor y restriccion unica', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'cashIntegrity.controller.ts'), 'utf8');
  assert.match(source, /pg_advisory_xact_lock/);
  const sql = fs.readFileSync(path.join(__dirname, '..', 'financial_integrity_phase3.sql'), 'utf8');
  assert.match(sql, /WHERE estado = 'ABIERTA'/);
});
test('37 ventas, abonos y gastos conservan BEGIN COMMIT ROLLBACK', () => {
  const sales = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'sales.controller.ts'), 'utf8');
  const expenses = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'expenses.controller.ts'), 'utf8');
  for (const source of [sales, expenses]) {
    assert.match(source, /query\('BEGIN'\)/);
    assert.match(source, /query\('COMMIT'\)/);
    assert.match(source, /query\('ROLLBACK'\)/);
  }
});
