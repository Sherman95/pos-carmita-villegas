const path = require('node:path');
const assert = require('node:assert/strict');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

process.env.PORT = process.env.PHASE6_SMOKE_PORT || '3990';

const jwt = require(path.join(__dirname, '..', 'node_modules', 'jsonwebtoken'));
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error('FALTA JWT_SECRET en backend/.env');
  process.exit(1);
}

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const results = [];

const check = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.error(`FAIL  ${name}: ${error.message}`);
  }
};

const api = async (method, route, { token, body } = {}) => {
  const response = await fetch(`${BASE}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let parsed = null;
  try { parsed = await response.json(); } catch { parsed = null; }
  return { status: response.status, body: parsed };
};

const waitForServer = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/auth/me`);
      if (response.status) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error('El servidor local no respondió en el tiempo esperado');
};

(async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();

  const users = (await client.query(
    'SELECT id, username, role, active, token_version FROM users ORDER BY username'
  )).rows;
  const owner = users.find((user) => user.username === 'admin');
  const collaborator = users.find((user) => user.role === 'user') || users.find((user) => user.username !== 'admin');
  const sidroAccount = (await client.query(
    'SELECT id, is_active, token_version FROM sidro_client_accounts WHERE is_active = true LIMIT 1'
  )).rows[0];
  await client.end();

  assert.ok(owner, 'No existe la cuenta admin local');
  assert.ok(collaborator, 'No existe una cuenta colaboradora local');

  require(path.join(__dirname, '..', 'dist', 'index.js'));
  await waitForServer();

  const sign = (user, { role = user.role, token_version = user.token_version } = {}) => jwt.sign(
    { sub: user.id, role, username: user.username, identity_type: 'pos_staff', token_version },
    SECRET,
    { algorithm: 'HS256', issuer: 'pos-carmita-villegas', audience: 'pos', expiresIn: '1h' }
  );

  const ownerToken = sign(owner);
  const staleOwnerToken = sign(owner, { token_version: owner.token_version + 5 });
  const collaboratorToken = sign(collaborator, { role: 'user' });

  await check('GET /api/auth/me devuelve owner con permisos completos', async () => {
    const me = await api('GET', '/api/auth/me', { token: ownerToken });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.role, 'owner');
    assert.ok(me.body.user.permissions.includes('roles.manage'));
    assert.ok(me.body.user.permissions.includes('audit.read'));
  });

  await check('GET /api/auth/users responde con roles canónicos', async () => {
    const response = await api('GET', '/api/auth/users', { token: ownerToken });
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body));
    const roles = new Set(response.body.map((user) => user.role));
    for (const role of roles) {
      assert.ok(['owner', 'admin', 'reception', 'professional'].includes(role), `rol no canónico: ${role}`);
    }
    assert.ok(response.body.some((user) => user.username === 'admin' && user.role === 'owner'));
  });

  await check('un colaborador legacy no puede leer usuarios', async () => {
    const response = await api('GET', '/api/auth/users', { token: collaboratorToken });
    assert.equal(response.status, 403);
    assert.equal(response.body.permission, 'users.read');
  });

  await check('un token con token_version desactualizado se rechaza', async () => {
    const response = await api('GET', '/api/auth/me', { token: staleOwnerToken });
    assert.equal(response.status, 401);
    assert.match(response.body.error, /sesión expiró/i);
  });

  await check('la propietaria no puede modificarse a sí misma desde administración', async () => {
    const response = await api('PATCH', `/api/auth/users/${owner.id}`, {
      token: ownerToken,
      body: { role: 'admin' }
    });
    assert.equal(response.status, 409);
  });

  await check('la auditoría local registra el bootstrap del propietario', async () => {
    const response = await api('GET', '/api/auth/audit', { token: ownerToken });
    assert.equal(response.status, 200);
    assert.ok(response.body.some((entry) => entry.action === 'OWNER_BOOTSTRAP_LOCAL'));
  });

  if (sidroAccount) {
    await check('un token SIDRO real no administra usuarios del POS', async () => {
      const sidroToken = jwt.sign(
        { sub: sidroAccount.id, id: sidroAccount.id, role: 'sidro_client', identity_type: 'sidro_client', token_version: sidroAccount.token_version },
        SECRET,
        { algorithm: 'HS256', issuer: 'pos-carmita-villegas', audience: 'sidro', expiresIn: '1h' }
      );
      const response = await api('GET', '/api/auth/users', { token: sidroToken });
      assert.equal(response.status, 403);
    });
  } else {
    console.log('SKIP  un token SIDRO real no administra usuarios del POS (sin cuentas SIDRO activas)');
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\nSmoke local Fase 6: ${results.length - failed.length}/${results.length} correctos`);
  process.exit(failed.length ? 1 : 0);
})().catch((error) => {
  console.error('Smoke local Fase 6 falló:', error.message);
  process.exit(1);
});
