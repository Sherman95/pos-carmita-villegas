const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'phase9-cleanup-test-secret-at-least-32-characters';
delete process.env.NOTIFICATIONS_CLEANUP_DISABLED;

const root = path.join(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const sql = source('notifications_cleanup_phase9.sql');
const phase9Sql = source('web_push_phase9.sql');
const serviceSource = source('src/services/notificationsCleanup.service.ts');
const workerSource = source('src/workers/notificationsCleanup.worker.ts');
const migrateSource = source('src/database/migrateNotificationsCleanup.ts');
const indexSource = source('src/index.ts');
const posRoot = path.join(root, '..', 'frontend');
const sidroRoot = path.join(root, '..', '..', 'SIDRO CARMITA VILLEGAS');
const readPos = (file) => fs.readFileSync(path.join(posRoot, file), 'utf8');
const readSidro = (file) => fs.readFileSync(path.join(sidroRoot, file), 'utf8');

const cleanup = require('../dist/services/notificationsCleanup.service.js');
const worker = require('../dist/workers/notificationsCleanup.worker.js');

after(async () => {
  try {
    await require('../dist/database/db.js').default.end();
  } catch {
    /* sin pool activo */
  }
});

const makeCleanupPool = (overrides = {}) => {
  const calls = [];
  const state = {
    locked: overrides.locked !== false,
    candidates: overrides.candidates || [],
    batched: overrides.batched || null,
    superseded: overrides.superseded ?? 0,
    failDelete: overrides.failDelete || false,
    connected: 0,
    released: 0,
    deletedIds: [],
    supersededIds: []
  };
  let batchIndex = 0;
  const client = {
    release: () => {
      state.released += 1;
    },
    query: async (sqlText, params = []) => {
      const text = String(sqlText).replace(/\s+/g, ' ').trim();
      calls.push({ text, params });
      if (text.startsWith('SELECT pg_try_advisory_lock')) return { rows: [{ locked: state.locked }] };
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (text.startsWith('SELECT id FROM notifications')) {
        const ids = state.batched ? state.batched[batchIndex] || [] : state.candidates;
        batchIndex += 1;
        return { rows: ids.map((id) => ({ id })) };
      }
      if (text.startsWith('UPDATE push_outbox')) {
        state.supersededIds.push(params[0]);
        return { rows: [], rowCount: state.superseded };
      }
      if (text.startsWith('DELETE FROM notifications')) {
        if (state.failDelete) throw Object.assign(new Error('boom'), { code: 'XX000' });
        state.deletedIds.push(params[0]);
        return { rows: [], rowCount: params[0] ? params[0].length : 0 };
      }
      if (text.startsWith('SELECT pg_advisory_unlock')) return { rows: [{ pg_advisory_unlock: true }] };
      throw new Error(`consulta inesperada: ${text}`);
    }
  };
  const pool = {
    async connect() {
      state.connected += 1;
      return client;
    }
  };
  return { pool, state, calls };
};

const findCall = (calls, prefix) => calls.find((call) => call.text.startsWith(prefix));

test('16 indice de retencion aditivo, parcial e idempotente', () => {
  assert.match(sql, /CREATE INDEX IF NOT EXISTS notifications_read_cleanup_idx/);
  assert.match(sql, /WHERE read_at IS NOT NULL/);
  assert.match(migrateSource, /CREATE INDEX IF NOT EXISTS notifications_read_cleanup_idx/);
  assert.match(migrateSource, /WHERE read_at IS NOT NULL/);
  assert.doesNotMatch(sql, /DROP|DELETE|TRUNCATE/i);
  assert.doesNotMatch(migrateSource, /DROP|DELETE|TRUNCATE/);
});

test('17 POS y SIDRO comparten el mismo predicado de retencion', async () => {
  const { pool, calls } = makeCleanupPool({ candidates: [1] });
  await cleanup.purgeReadNotifications({ pool });
  const candidates = findCall(calls, 'SELECT id FROM notifications');
  assert.match(candidates.text, /read_at IS NOT NULL/);
  assert.doesNotMatch(candidates.text, /recipient_type/);
});

test('18 jamas se borra una notificacion sin leer', async () => {
  const { pool, calls } = makeCleanupPool({ candidates: [1] });
  await cleanup.purgeReadNotifications({ pool });
  const candidates = findCall(calls, 'SELECT id FROM notifications');
  assert.match(candidates.text, /read_at <= NOW\(\)/);
  assert.doesNotMatch(candidates.text, /read_at IS NULL/);
});

test('19 retencion configurada de 24 horas', () => {
  assert.equal(cleanup.NOTIFICATIONS_RETENTION_HOURS, 24);
  assert.match(serviceSource, /NOTIFICATIONS_RETENTION_HOURS = 24/);
});

test('20 regla de corte es <= 24 horas exactas', async () => {
  const { pool, calls } = makeCleanupPool({ candidates: [1] });
  await cleanup.purgeReadNotifications({ pool });
  const candidates = findCall(calls, 'SELECT id FROM notifications');
  assert.match(candidates.text, /read_at <= NOW\(\) - \(\$1::int \* INTERVAL '1 hour'\)/);
  assert.deepEqual(candidates.params, [24, 500]);
});

test('21 lotes por defecto de 500 con techo de 40', () => {
  assert.match(serviceSource, /DEFAULT_BATCH_SIZE = 500/);
  assert.match(serviceSource, /DEFAULT_MAX_BATCHES = 40/);
});

test('22 purga fisica con DELETE sin borrado logico', async () => {
  const { pool, calls, state } = makeCleanupPool({ candidates: [7] });
  const result = await cleanup.purgeReadNotifications({ pool });
  assert.ok(findCall(calls, 'DELETE FROM notifications'));
  assert.doesNotMatch(serviceSource, /SET deleted|deleted_at|archived/i);
  assert.equal(result.deleted, 1);
  assert.deepEqual(state.deletedIds[0], [7]);
});

test('23 jobs PENDING/FAILED_RETRY se superseden antes del DELETE', async () => {
  const { pool, calls } = makeCleanupPool({ candidates: [9], superseded: 2 });
  const result = await cleanup.purgeReadNotifications({ pool });
  const updateIndex = calls.findIndex((call) => call.text.startsWith('UPDATE push_outbox'));
  const deleteIndex = calls.findIndex((call) => call.text.startsWith('DELETE FROM notifications'));
  assert.ok(updateIndex > -1, 'debe superseder jobs');
  assert.ok(deleteIndex > updateIndex, 'el supersede debe ocurrir antes del DELETE');
  assert.match(calls[updateIndex].text, /status='SUPERSEDED'/);
  assert.match(calls[updateIndex].text, /status IN \('PENDING','FAILED_RETRY'\)/);
  assert.equal(result.supersededJobs, 2);
});

test('24 push_outbox cae por cascada con la FK real', () => {
  assert.match(
    phase9Sql,
    /notification_id BIGINT NOT NULL REFERENCES public\.notifications\(id\) ON DELETE CASCADE/
  );
});

test('25 jobs PROCESSING no se tocan manualmente; los cubre la cascada', async () => {
  const { pool, calls } = makeCleanupPool({ candidates: [11] });
  await cleanup.purgeReadNotifications({ pool });
  const update = findCall(calls, 'UPDATE push_outbox');
  assert.doesNotMatch(update.text, /PROCESSING/);
});

test('26 supersede y DELETE usan exactamente los mismos ids', async () => {
  const { pool, calls } = makeCleanupPool({ candidates: [31, 32, 33] });
  await cleanup.purgeReadNotifications({ pool });
  const update = findCall(calls, 'UPDATE push_outbox');
  const del = findCall(calls, 'DELETE FROM notifications');
  assert.deepEqual(update.params[0], [31, 32, 33]);
  assert.deepEqual(del.params[0], [31, 32, 33]);
});

test('27 segunda instancia se omite sin el advisory lock', async () => {
  const { pool, calls, state } = makeCleanupPool({ locked: false });
  const result = await cleanup.purgeReadNotifications({ pool });
  assert.equal(result.skipped, true);
  assert.equal(calls.filter((call) => call.text.startsWith('SELECT id FROM')).length, 0);
  assert.equal(calls.filter((call) => call.text.startsWith('DELETE FROM')).length, 0);
  assert.equal(calls.filter((call) => call.text.startsWith('SELECT pg_advisory_unlock')).length, 0);
  assert.equal(state.released, 1);
});

test('28 error a mitad libera lock, hace ROLLBACK y propaga', async () => {
  const { pool, calls, state } = makeCleanupPool({ candidates: [5], failDelete: true });
  await assert.rejects(() => cleanup.purgeReadNotifications({ pool }), /boom/);
  assert.ok(calls.some((call) => call.text === 'ROLLBACK'));
  assert.equal(calls.filter((call) => call.text === 'COMMIT').length, 0);
  assert.ok(calls.some((call) => call.text.startsWith('SELECT pg_advisory_unlock')));
  assert.equal(state.released, 1);
});

test('29 procesa por lotes y respeta maxBatches', async () => {
  const { pool, calls, state } = makeCleanupPool({ batched: [[1, 2], [3, 4]] });
  const result = await cleanup.purgeReadNotifications({ pool, batchSize: 2, maxBatches: 2 });
  assert.equal(result.batches, 2);
  assert.equal(result.deleted, 4);
  assert.equal(calls.filter((call) => call.text.startsWith('SELECT id FROM')).length, 2);
  assert.deepEqual(state.deletedIds, [[1, 2], [3, 4]]);
});

test('30 lote incompleto termina sin consultar de mas', async () => {
  const { pool, calls } = makeCleanupPool({ candidates: [8] });
  const result = await cleanup.purgeReadNotifications({ pool, batchSize: 500 });
  assert.equal(result.batches, 1);
  assert.equal(calls.filter((call) => call.text.startsWith('SELECT id FROM')).length, 1);
});

test('31 ejecucion repetida es idempotente', async () => {
  const first = makeCleanupPool({ candidates: [1, 2] });
  await cleanup.purgeReadNotifications({ pool: first.pool });
  const second = makeCleanupPool({ candidates: [] });
  const result = await cleanup.purgeReadNotifications({ pool: second.pool });
  assert.equal(result.deleted, 0);
  assert.equal(result.batches, 0);
});

test('32 worker corre cada 30 minutos con unref y un solo interval', () => {
  assert.match(workerSource, /CLEANUP_INTERVAL_MS = 30 \* 60 \* 1000/);
  assert.match(workerSource, /\.unref\?\.\(\)/);
  assert.equal((workerSource.match(/setInterval\(/g) || []).length, 1);
  assert.doesNotMatch(workerSource, /setTimeout/);
});

test('33 worker deshabilitado por env no arranca', () => {
  process.env.NOTIFICATIONS_CLEANUP_DISABLED = 'true';
  try {
    assert.equal(worker.startNotificationsCleanupWorker(), null);
    assert.equal(worker.startNotificationsCleanupWorker(), null);
  } finally {
    delete process.env.NOTIFICATIONS_CLEANUP_DISABLED;
  }
});

test('34 errores del worker no tumban el backend', () => {
  assert.match(workerSource, /catch \(error/);
  assert.match(workerSource, /console\.error\('\[CLEANUP\]\[WORKER\] Error de limpieza'/);
});

test('35 logs del worker sin PII', () => {
  assert.match(workerSource, /deleted:/);
  assert.match(workerSource, /supersededJobs:/);
  assert.match(workerSource, /batches:/);
  assert.match(workerSource, /durationMs:/);
  assert.doesNotMatch(workerSource, /title|body|recipient_id|endpoint/);
});

test('36 env NOTIFICATIONS_CLEANUP_DISABLED evita consultas', async () => {
  process.env.NOTIFICATIONS_CLEANUP_DISABLED = 'true';
  const { pool, state } = makeCleanupPool({ candidates: [1] });
  try {
    const result = await cleanup.purgeReadNotifications({ pool });
    assert.equal(result.skipped, true);
    assert.equal(state.connected, 0);
  } finally {
    delete process.env.NOTIFICATIONS_CLEANUP_DISABLED;
  }
});

test('37 index.ts inicializa indice, arranca y detiene el worker en senales', () => {
  assert.match(indexSource, /initNotificationsCleanupIndex/);
  assert.match(indexSource, /await initNotificationsCleanupIndex\(\)/);
  assert.match(indexSource, /startNotificationsCleanupWorker\(\)/);
  const signalIndex = indexSource.indexOf('SIGTERM');
  assert.ok(signalIndex > -1, 'debe manejar SIGTERM');
  assert.match(indexSource.slice(signalIndex), /stopNotificationsCleanupWorker\(\)/);
});

test('38 frontends no purgan ni manejan retencion local', () => {
  const targets = [
    ['SIDRO service', readSidro('src/app/services/notifications.service.ts')],
    ['SIDRO bell', readSidro('src/app/components/notifications-bell/notifications-bell.component.ts')],
    ['POS service', readPos('src/app/services/notifications.service.ts')],
    ['POS bell', readPos('src/app/components/notifications-bell/notifications-bell.ts')]
  ];
  for (const [name, text] of targets) {
    assert.doesNotMatch(text, /purgeReadNotifications|DELETE\s+FROM/i, `${name} no debe purgar`);
    assert.doesNotMatch(text, /retentionHours|NOTIFICATIONS_RETENTION/i, `${name} no debe contener retencion`);
  }
});

test('39 contadores se leen del servidor tras la purga', () => {
  const sidroService = readSidro('src/app/services/notifications.service.ts');
  assert.match(sidroService, /unreadCount/);
  assert.match(sidroService, /refresh\(limit/);
  assert.doesNotMatch(sidroService, /localStorage|sessionStorage/);
});
