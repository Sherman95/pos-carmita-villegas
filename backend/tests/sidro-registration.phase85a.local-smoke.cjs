const assert = require('node:assert/strict');
const { Client } = require('pg');
require('dotenv').config();

const { initSidroCompleteRegistration85, verifySidroCompleteRegistration85 } = require('../dist/database/migrateSidroCompleteRegistration85.js');
const { validateEcuadorDocument, normalizeDocumento } = require('../dist/utils/ecuadorId.js');

(async () => {
  const configured = new URL(process.env.DATABASE_URL);
  const expectedDb = configured.pathname.replace(/^\//, '');
  if (
    !['localhost', '127.0.0.1', '::1'].includes(configured.hostname) ||
    expectedDb.toLowerCase() !== 'poscarmitavlocal'
  ) {
    throw new Error('Smoke Fase 8.5A abortado: DATABASE_URL no apunta a poscarmitaVlocal en localhost');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const identity = (await client.query(
    'SELECT current_database() AS db, inet_server_addr()::text AS address'
  )).rows[0];
  assert.equal(String(identity.db).toLowerCase(), 'poscarmitavlocal');
  assert.match(String(identity.address), /^(::1\/128|127\.0\.0\.1\/32)$/);

  await initSidroCompleteRegistration85();
  await initSidroCompleteRegistration85();

  const report = await verifySidroCompleteRegistration85();
  assert.equal(report.ok, true, `La verificacion de la migracion debe ser ok: ${JSON.stringify(report)}`);
  assert.deepEqual(report.missing_columns, []);
  assert.deepEqual(report.wrong_column_types, []);
  assert.equal(report.documento_check_ok, true);
  assert.equal(report.documento_unique_index_ok, true);
  assert.equal(report.telefono_index_ok, true);
  assert.equal(report.email_verification_constraint_ok, true);

  const columns = (
    await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'sidro_client_accounts'`
    )
  ).rows.map((row) => row.column_name);
  for (const expected of ['documento', 'direccion', 'privacy_accepted_at']) {
    assert.ok(columns.includes(expected), `Falta la columna ${expected}`);
  }

  const constraints = (
    await client.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
       WHERE conrelid = 'sidro_client_accounts'::regclass`
    )
  ).rows;
  const documentConstraint = constraints.find((row) => row.conname === 'sidro_client_accounts_documento_check');
  assert.ok(documentConstraint, 'Falta la restriccion de longitud del documento');
  assert.match(documentConstraint.definition, /\^\[0-9\]\{10\}\$/);
  assert.match(documentConstraint.definition, /\^\[0-9\]\{13\}\$/);

  const emailConstraint = constraints.find((row) => row.conname === 'sidro_client_accounts_email_verification_pair_check');
  assert.ok(emailConstraint, 'Falta la restriccion de par de verificacion de correo');
  assert.match(
    emailConstraint.definition,
    /\(email_verification_token_hash IS NULL\) = \(email_verification_expires_at IS NULL\)/,
    'La restriccion debe exigir token y expiración juntos (registro 8.5A sin pending_email)'
  );

  const indexes = (
    await client.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'sidro_client_accounts'`)
  ).rows.map((row) => row.indexname);
  assert.ok(indexes.includes('sidro_client_accounts_documento_unique_idx'));
  assert.ok(indexes.includes('sidro_client_accounts_telefono_digits_idx'));

  assert.equal(normalizeDocumento(' 0122345671 '), '0122345671');
  assert.equal(validateEcuadorDocument('0122345671').valid, true);
  assert.equal(validateEcuadorDocument('0122345671').verification_level, 'algorithmic');
  assert.equal(validateEcuadorDocument('1790012349001').checksum_valid, false);
  assert.equal(validateEcuadorDocument('1790012349001').valid, true);
  assert.equal(validateEcuadorDocument('1790012349001').verification_level, 'structure_only');
  assert.equal(validateEcuadorDocument('1790012349001').official_verification, 'not_performed');

  await client.query('BEGIN');
  try {
    const suffix = String(Date.now()).slice(-7);
    const phone = (offset) => `09${suffix}${offset}`;
    const inserted = (await client.query(
      `INSERT INTO sidro_client_accounts (nombre_completo, telefono, documento, direccion, privacy_accepted_at, password_hash)
       VALUES ($1, $2, $3, $4, NOW(), $5) RETURNING id, documento`,
      ['Smoke Fase 85A', phone(1), '0122345671', 'Direccion de prueba local', 'smoke-hash']
    )).rows[0];
    assert.equal(inserted.documento, '0122345671', 'El cero inicial del documento debe preservarse');

    const pendingAccount = (await client.query(
      `INSERT INTO sidro_client_accounts (nombre_completo, telefono, email, email_verification_token_hash, email_verification_expires_at, password_hash)
       VALUES ($1, $2, $3, repeat('b',64), NOW() + interval '30 minutes', 'smoke-hash') RETURNING id, email_verified_at`,
      ['Smoke Pendiente', phone(4), `smoke85a-${suffix}@example.invalid`]
    )).rows[0];
    assert.equal(pendingAccount.email_verified_at, null, 'El registro 8.5A debe poder nacer con token sin pending_email');

    let orphanTokenCode = null;
    await client.query('SAVEPOINT orphan_token');
    try {
      await client.query(`UPDATE sidro_client_accounts SET email_verification_expires_at=NULL WHERE id=$1`, [pendingAccount.id]);
    } catch (error) {
      orphanTokenCode = error.code;
      await client.query('ROLLBACK TO SAVEPOINT orphan_token');
    }
    assert.equal(orphanTokenCode, '23514', 'La restriccion debe rechazar token sin expiración');

    let orphanPendingCode = null;
    await client.query('SAVEPOINT orphan_pending');
    try {
      await client.query(`UPDATE sidro_client_accounts SET pending_email=$1 WHERE id=$2`, [`smoke-pending-${suffix}@example.invalid`, inserted.id]);
    } catch (error) {
      orphanPendingCode = error.code;
      await client.query('ROLLBACK TO SAVEPOINT orphan_pending');
    }
    assert.equal(orphanPendingCode, '23514', 'La restriccion debe rechazar pending_email sin token');

    let duplicateCode = null;
    await client.query('SAVEPOINT dup');
    try {
      await client.query(
        `INSERT INTO sidro_client_accounts (nombre_completo, telefono, documento, direccion, password_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        ['Smoke Duplicado', phone(2), '0122345671', 'Otra direccion de prueba', 'smoke-hash']
      );
    } catch (error) {
      duplicateCode = error.code;
      await client.query('ROLLBACK TO SAVEPOINT dup');
    }
    assert.equal(duplicateCode, '23505', 'El indice unico debe rechazar documentos duplicados');

    let checkCode = null;
    await client.query('SAVEPOINT invalid');
    try {
      await client.query(
        `INSERT INTO sidro_client_accounts (nombre_completo, telefono, documento, direccion, password_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        ['Smoke Invalido', phone(3), '123', 'Direccion de prueba', 'smoke-hash']
      );
    } catch (error) {
      checkCode = error.code;
      await client.query('ROLLBACK TO SAVEPOINT invalid');
    }
    assert.equal(checkCode, '23514', 'La restriccion debe rechazar longitudes invalidas');
  } finally {
    await client.query('ROLLBACK');
  }

  const leftovers = (
    await client.query(
      `SELECT COUNT(*)::int AS count FROM sidro_client_accounts WHERE nombre_completo LIKE 'Smoke%'`
    )
  ).rows[0].count;
  assert.equal(leftovers, 0, 'El smoke no debe dejar filas');

  await client.end();
  console.log(
    'Smoke Fase 8.5A OK: migracion idempotente, columnas documento/direccion/privacidad, constraint de longitud, indice unico de documento y de telefono, token de registro inicial sin pending_email permitido con salvaguardas de par token/expiración, ceros iniciales preservados y rollback limpio.'
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
