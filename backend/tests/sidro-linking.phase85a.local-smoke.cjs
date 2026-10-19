const assert = require('node:assert/strict');
const { Client } = require('pg');
require('dotenv').config();

const { linkAccount, createClientAndLink } = require('../dist/controllers/adminSidro.controller.js');

const fakeRes = () => {
  const captured = { statusCode: 200, body: null };
  const res = {
    status(code) {
      captured.statusCode = code;
      return res;
    },
    json(payload) {
      captured.body = payload;
      return res;
    }
  };
  return { res, captured };
};

(async () => {
  const configured = new URL(process.env.DATABASE_URL);
  const expectedDb = configured.pathname.replace(/^\//, '');
  if (
    !['localhost', '127.0.0.1', '::1'].includes(configured.hostname) ||
    expectedDb.toLowerCase() !== 'poscarmitavlocal'
  ) {
    throw new Error('Smoke de vinculación abortado: DATABASE_URL no apunta a poscarmitaVlocal en localhost');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const identity = (await client.query(
    'SELECT current_database() AS db, inet_server_addr()::text AS address'
  )).rows[0];
  assert.equal(String(identity.db).toLowerCase(), 'poscarmitavlocal');
  assert.match(String(identity.address), /^(::1\/128|127\.0\.0\.1\/32)$/);

  const owner = (await client.query(`SELECT id FROM users WHERE role = 'owner' AND active = true LIMIT 1`)).rows[0];
  assert.ok(owner, 'Se requiere un usuario owner local para el smoke');

  const suffix = String(Date.now()).slice(-7);
  const emailTag = `smoke-link-${suffix}`;
  const probeAccountIds = [];

  try {
    const accountForExisting = (await client.query(
      `INSERT INTO sidro_client_accounts (nombre_completo, telefono, email, documento, direccion, password_hash, token_version, is_active)
       VALUES ('Smoke Vinculacion Cuenta A', $1, $2, '0122345671', 'Direccion smoke vinculacion', 'smoke-hash', 0, true) RETURNING id`,
      [`+59398${suffix}`, `${emailTag}-a@example.invalid`]
    )).rows[0];
    probeAccountIds.push(accountForExisting.id);
    const posClient = (await client.query(
      `INSERT INTO clients (nombre, cedula, telefono, email, direccion)
       VALUES ('Smoke Vinculacion Cliente', '1710034065', $1, $2, 'Direccion smoke vinculacion') RETURNING id`,
      [`+59397${suffix}`, `${emailTag}-pos@example.invalid`]
    )).rows[0];

    const existing = fakeRes();
    await linkAccount({ body: { sidro_account_id: accountForExisting.id, client_id: posClient.id }, userId: owner.id }, existing.res);
    assert.equal(existing.captured.statusCode, 200, `Vincular cuenta existente debe responder 200: ${JSON.stringify(existing.captured.body)}`);

    const auditExisting = (await client.query(
      `SELECT target_user_id, metadata FROM admin_audit_log WHERE action = 'SIDRO_ACCOUNT_LINKED' AND metadata->>'link_id' = $1`,
      [String(existing.captured.body.id)]
    )).rows[0];
    assert.ok(auditExisting, 'La auditoría SIDRO_ACCOUNT_LINKED debe quedar registrada');
    assert.equal(auditExisting.target_user_id, null, 'target_user_id debe ser NULL (no es un usuario del POS)');
    assert.equal(auditExisting.metadata.sidro_account_id, accountForExisting.id);

    const accountForNewClient = (await client.query(
      `INSERT INTO sidro_client_accounts (nombre_completo, telefono, email, documento, direccion, password_hash, token_version, is_active)
       VALUES ('Smoke Vinculacion Cuenta B', $1, $2, '0926687856', 'Direccion smoke vinculacion', 'smoke-hash', 0, true) RETURNING id`,
      [`+59395${suffix}`, `${emailTag}-b@example.invalid`]
    )).rows[0];
    probeAccountIds.push(accountForNewClient.id);

    const created = fakeRes();
    await createClientAndLink({
      body: {
        sidro_account_id: accountForNewClient.id,
        nombre: 'Smoke Vinculacion Nuevo',
        cedula: '0926687856',
        telefono: `+59396${suffix}`,
        email: `${emailTag}-nuevo@example.invalid`,
        direccion: 'Direccion smoke vinculacion nuevo'
      },
      userId: owner.id
    }, created.res);
    assert.equal(created.captured.statusCode, 201, `Crear cliente y vincular debe responder 201: ${JSON.stringify(created.captured.body)}`);

    const auditCreated = (await client.query(
      `SELECT target_user_id, metadata FROM admin_audit_log WHERE action = 'SIDRO_CLIENT_CREATED_AND_LINKED' AND metadata->>'link_id' = $1`,
      [String(created.captured.body.link_id)]
    )).rows[0];
    assert.ok(auditCreated, 'La auditoría SIDRO_CLIENT_CREATED_AND_LINKED debe quedar registrada');
    assert.equal(auditCreated.target_user_id, null, 'target_user_id debe ser NULL (no es un usuario del POS)');
    assert.equal(auditCreated.metadata.client_id, String(created.captured.body.client.id));
    assert.equal(auditCreated.metadata.sidro_account_id, accountForNewClient.id);
  } finally {
    for (const accountId of probeAccountIds) {
      await client.query(`DELETE FROM sidro_account_links WHERE sidro_account_id = $1`, [accountId]);
    }
    await client.query(`DELETE FROM clients WHERE nombre LIKE 'Smoke Vinculacion%'`);
    for (const accountId of probeAccountIds) {
      await client.query(`DELETE FROM admin_audit_log WHERE metadata->>'sidro_account_id' = $1`, [accountId]);
    }
    await client.query(`DELETE FROM sidro_client_accounts WHERE nombre_completo LIKE 'Smoke Vinculacion%'`);
  }

  const leftovers = (await client.query(
    `SELECT (SELECT COUNT(*)::int FROM sidro_client_accounts WHERE nombre_completo LIKE 'Smoke Vinculacion%') AS accounts,
            (SELECT COUNT(*)::int FROM clients WHERE nombre LIKE 'Smoke Vinculacion%') AS clients,
            (SELECT COUNT(*)::int FROM admin_audit_log WHERE metadata->>'sidro_account_id' = ANY($1::text[])) AS audits`,
    [probeAccountIds]
  )).rows[0];
  assert.deepEqual(leftovers, { accounts: 0, clients: 0, audits: 0 }, `El smoke no debe dejar filas: ${JSON.stringify(leftovers)}`);

  await client.end();
  console.log(
    'Smoke vinculación Fase 8.5A OK: /link y /link/create-client responden 200/201 contra la BD real, auditoría con target_user_id NULL y link_id en metadata, y limpieza total.'
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
