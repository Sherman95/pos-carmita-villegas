const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.JWT_SECRET = 'phase9-web-push-test-secret-at-least-32-characters';
process.env.WEB_PUSH_ENABLED = 'false';

const root = path.join(__dirname, '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const sql = source('web_push_phase9.sql');
const notificationSource = source('src/services/notifications.service.ts');
const outboxSource = source('src/services/pushOutbox.service.ts');
const workerSource = source('src/workers/webPushWorkerPhase9.ts');
const controllerSource = source('src/controllers/pushSubscriptions.controller.ts');
const posRoutes = source('src/routes/notifications.routes.ts');
const sidroRoutes = source('src/routes/sidro.routes.ts');
const indexSource = source('src/index.ts');
const posRoot = path.join(root, '..', 'frontend');
const sidroRoot = path.join(root, '..', '..', 'SIDRO CARMITA VILLEGAS');
const readPos = (file) => fs.readFileSync(path.join(posRoot, file), 'utf8');
const readSidro = (file) => fs.readFileSync(path.join(sidroRoot, file), 'utf8');

const pushPolicy = require('../dist/services/pushOutbox.service.js');
const worker = require('../dist/workers/webPushWorkerPhase9.js');
const { NotificationsService } = require('../dist/services/notifications.service.js');

test('01 migración crea push_subscriptions', () => assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.push_subscriptions/));
test('02 migración crea push_outbox', () => assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.push_outbox/));
test('03 migración no altera destructivamente notifications', () => assert.doesNotMatch(sql, /DROP\s+TABLE|TRUNCATE|DELETE\s+FROM\s+notifications/i));
test('04 endpoint de suscripción es único', () => assert.match(sql, /push_subscriptions_endpoint_unique UNIQUE \(endpoint\)/));
test('05 outbox deduplica por notificación y dispositivo', () => assert.match(sql, /UNIQUE \(notification_id, subscription_id\)/));
test('06 outbox referencia notificación interna', () => assert.match(sql, /notification_id BIGINT NOT NULL REFERENCES public\.notifications\(id\)/));
test('07 outbox limita estados válidos', () => assert.match(sql, /FAILED_PERMANENT.*SUPERSEDED/));
test('08 migración conserva varios dispositivos por cuenta', () => assert.doesNotMatch(sql, /UNIQUE \(subscriber_type, subscriber_id\)/));
test('09 suscripción conserva token_version', () => assert.match(sql, /token_version INTEGER NOT NULL DEFAULT 0/));
test('10 migración es idempotente', () => assert.match(sql, /IF NOT EXISTS/g));

test('11 push desactivado no es operativo', () => { process.env.WEB_PUSH_ENABLED = 'false'; assert.equal(pushPolicy.webPushOperational(), false); });
test('12 ausencia de VAPID no rompe canal interno', () => { process.env.WEB_PUSH_ENABLED = 'true'; delete process.env.VAPID_PRIVATE_KEY; assert.equal(pushPolicy.webPushOperational(), false); });
test('13 VAPID completo habilita la política', () => { process.env.WEB_PUSH_ENABLED='true'; process.env.VAPID_PUBLIC_KEY='public'; process.env.VAPID_PRIVATE_KEY='private'; process.env.VAPID_SUBJECT='mailto:test@example.com'; assert.equal(pushPolicy.webPushOperational(), true); });
test('14 inserción nueva devuelve id y encola', async () => {
  const calls=[]; const client={query:async(sqlText)=>{calls.push(String(sqlText)); return /INSERT INTO notifications/.test(sqlText)?{rows:[{id:'91'}]}:{rows:[{id:'12'}]};}};
  const id=await NotificationsService.insertForRecipient(client,'pos_user','user-1',{type:'x',title:'x',body:'x',dedupeKey:'d'});
  assert.equal(id,'91'); assert.equal(calls.filter(x=>/push_outbox/.test(x)).length,1);
});
test('15 conflicto de bandeja no crea otro Push', async () => {
  const calls=[]; const client={query:async(sqlText)=>{calls.push(String(sqlText)); return {rows:[]};}};
  const id=await NotificationsService.insertForRecipient(client,'sidro_account','a',{type:'x',title:'x',body:'x',dedupeKey:'d'});
  assert.equal(id,null); assert.equal(calls.filter(x=>/push_outbox/.test(x)).length,0);
});
test('16 encolado usa la conexión transaccional recibida', () => assert.match(notificationSource, /enqueueNotificationPush\(client, notificationId/));
test('17 INSERT interno conserva ON CONFLICT', () => assert.match(notificationSource, /ON CONFLICT \(recipient_type, recipient_id, dedupe_key\) DO NOTHING/));
test('18 INSERT interno usa RETURNING id', () => assert.match(notificationSource, /DO NOTHING\s+RETURNING id/));
test('19 fanout solo usa suscripciones activas del destinatario', () => assert.match(outboxSource, /subscriber_type = \$2[\s\S]*subscriber_id = \$3[\s\S]*disabled_at IS NULL/));
test('20 WEB_PUSH_ENABLED false omite outbox', async () => { process.env.WEB_PUSH_ENABLED='false'; let calls=0; const client={query:async()=>{calls++;return{rows:[]}}}; assert.equal(await pushPolicy.enqueueNotificationPush(client,1,'pos_user','x'),0); assert.equal(calls,0); });

test('21 URL POS conserva deep-link permitido', () => assert.equal(worker.safePushUrl('pos_user','/citas/solicitudes?open=5'),'/citas/solicitudes?open=5'));
test('22 URL SIDRO conserva deep-link permitido', () => assert.equal(worker.safePushUrl('sidro_account','/my-requests?open=5'),'/my-requests?open=5'));
test('23 URL externa se sustituye por fallback seguro', () => assert.equal(worker.safePushUrl('sidro_account','https://evil.example'),'/my-requests'));
test('24 URL protocol-relative se rechaza', () => assert.equal(worker.safePushUrl('pos_user','//evil.example'),'/citas/solicitudes'));
test('25 payload POS no contiene PII de la bandeja', () => { const p=worker.buildPrivatePushPayload({recipient_type:'pos_user',notification_id:1,data:{url:'/citas/solicitudes?open=1'},title:'Ana',body:'0999999999'}); assert.doesNotMatch(p,/Ana|0999999999/); });
test('26 payload SIDRO conserva fallback seguro para eventos desconocidos', () => { const p=JSON.parse(worker.buildPrivatePushPayload({recipient_type:'sidro_account',notification_id:2,data:{url:'/my-requests?open=1'}})); assert.match(p.notification.body,/actualización de tu cita/i); });
test('27 payload usa tag por notificación', () => { const p=JSON.parse(worker.buildPrivatePushPayload({recipient_type:'sidro_account',notification_id:22,data:{}})); assert.equal(p.notification.tag,'notification-22'); });
test('28 payload usa operación Angular segura', () => { const p=JSON.parse(worker.buildPrivatePushPayload({recipient_type:'pos_user',notification_id:3,data:{}})); assert.equal(p.notification.data.onActionClick.default.operation,'navigateLastFocusedOrOpen'); });
test('29 404 invalida la suscripción', () => assert.equal(worker.isInvalidSubscriptionError({statusCode:404}),true));
test('30 410 invalida la suscripción', () => assert.equal(worker.isInvalidSubscriptionError({statusCode:410}),true));
test('31 503 es transitorio', () => assert.equal(worker.isTransientPushError({statusCode:503}),true));
test('32 error de DNS es transitorio', () => assert.equal(worker.isTransientPushError({code:'ENOTFOUND'}),true));
test('33 backoff crece y tiene límite', () => { assert.ok(worker.pushRetryDelaySeconds(2)>worker.pushRetryDelaySeconds(1)); assert.equal(worker.pushRetryDelaySeconds(99),1800); });
test('34 worker usa SKIP LOCKED', () => assert.match(workerSource,/FOR UPDATE SKIP LOCKED/));
test('35 worker recupera PROCESSING atascado', () => assert.match(workerSource,/STALE_PROCESSING/));
test('36 worker bloquea cuentas inactivas o sesiones revocadas', () => { assert.match(workerSource,/is_active=true/); assert.match(workerSource,/token_version,0\)=subscription\.token_version/); });
test('37 worker desactiva endpoints inválidos', () => assert.match(workerSource,/UPDATE push_subscriptions SET disabled_at=NOW\(\)/));
test('38 worker tiene límite de intentos', () => assert.match(workerSource,/const MAX_ATTEMPTS = 5/));

test('39 POS deriva identidad del JWT y no del body', () => { assert.match(posRoutes,/verifyToken, requireStaff/); assert.doesNotMatch(controllerSource,/req\.body\?\.subscriber/); });
test('40 SIDRO deriva identidad del JWT y no del body', () => { assert.match(sidroRoutes,/verifyToken, requireSidroClient/); assert.match(controllerSource,/authIdentity === 'sidro_client'/); });
test('41 borrar suscripción exige identidad y endpoint propios', () => assert.match(controllerSource,/endpoint=\$1 AND subscriber_type=\$2 AND subscriber_id=\$3/));
test('42 registro valida HTTPS y tamaños', () => { assert.match(controllerSource,/url\.protocol !== 'https:'/); assert.match(controllerSource,/endpoint\.length > 2048/); });
test('43 cambio de dueño invalida trabajos anteriores', () => assert.match(controllerSource,/changedOwner[\s\S]*status='SUPERSEDED'/));
test('44 endpoints antiguos de bandeja se conservan', () => { assert.match(posRoutes,/router\.get\('\/'/); assert.match(sidroRoutes,/router\.get\('\/notifications', listNotifications/); });
test('45 SIDRO conserva polling de 30 segundos', () => assert.match(readSidro('src/app/services/notifications.service.ts'),/startPolling\(intervalMs = 30000\)/));
test('46 POS conserva polling de 30 segundos', () => assert.match(readPos('src/app/services/notifications.service.ts'),/startPolling\(intervalMs = 30000\)/));
test('47 SIDRO reutiliza ngsw-worker y SwPush', () => { assert.match(readSidro('src/app/app.config.ts'),/ngsw-worker\.js/); assert.match(readSidro('src/app/services/push-notifications.service.ts'),/SwPush/); });
test('48 POS registra un solo Angular service worker', () => { assert.match(readPos('src/app/app.config.ts'),/provideServiceWorker\('ngsw-worker\.js'/); assert.equal((readPos('src/app/app.config.ts').match(/provideServiceWorker\(/g)||[]).length,1); });
test('49 ningún frontend pide permiso al inicializar', () => { assert.doesNotMatch(readPos('src/app/services/push-notifications.service.ts').split('async enable')[0],/requestSubscription/); assert.doesNotMatch(readSidro('src/app/services/push-notifications.service.ts').split('async enable')[0],/requestSubscription/); });
test('50 ambos frontends ofrecen desactivación', () => { assert.match(readPos('src/app/services/push-notifications.service.ts'),/disable\(\)/); assert.match(readSidro('src/app/services/push-notifications.service.ts'),/disable\(\)/); });
test('51 ambos guards conservan returnUrl', () => { assert.match(readPos('src/app/services/auth.guard.ts'),/returnUrl: state\.url/); assert.match(readSidro('src/app/auth.guard.ts'),/returnUrl: state\.url/); });
test('52 returnUrl rechaza redirecciones externas', () => { assert.match(readPos('src/app/utils/safe-return-url.ts'),/value\.startsWith\('\/\/'\)/); assert.match(readSidro('src/app/utils/safe-return-url.ts'),/parsed\.origin === window\.location\.origin/); });
test('53 logout intenta revocar la suscripción antes de limpiar sesión', () => { assert.match(readPos('src/app/services/auth.service.ts'),/revokePushSubscription\(\);[\s\S]*removeItem\('token'\)/); assert.match(readSidro('src/app/services/auth.service.ts'),/revokePushSubscription\(\);[\s\S]*memoryToken = null/); });
test('54 POS no define dataGroups para APIs privadas', () => assert.doesNotMatch(readPos('ngsw-config.json'),/dataGroups/));
test('55 worker solo inicia tras verificar el esquema', () => assert.match(indexSource,/pushSchema\.ok\) startWebPushWorker/));

const workerPool = (overrides = {}) => {
  const state = { claimed: false, marks: [], disabled: false };
  const detail = {
    id: 1, notification_id: 10, subscription_id: 20, attempts: 1,
    recipient_type: 'sidro_account', recipient_id: 'account-1', data: { url: '/my-requests?open=5' }, read_at: null,
    endpoint: 'https://push.example.invalid/device', p256dh: 'A'.repeat(64), auth: 'B'.repeat(24), disabled_at: null,
    account_active: true, subscriber_type: 'sidro_account', subscriber_id: 'account-1', ...overrides
  };
  const client = { release() {}, async query(sqlText, params = []) {
    const text = String(sqlText).replace(/\s+/g,' ');
    if (/STALE_PROCESSING/.test(text)) return { rows: [] };
    if (/WITH candidate AS/.test(text)) {
      if (state.claimed) return { rows: [] };
      state.claimed = true; return { rows: [{ id:1, notification_id:10, subscription_id:20, attempts:1 }] };
    }
    if (/FROM push_outbox job/.test(text)) return { rows: [detail] };
    if (/UPDATE push_subscriptions SET disabled_at/.test(text)) { state.disabled = true; return { rows: [] }; }
    if (/UPDATE push_outbox SET status=\$2/.test(text)) { state.marks.push({ status: params[1], code: params[2], delay: params[4] }); return { rows: [] }; }
    return { rows: [] };
  }};
  return { state, pool: { async connect() { return client; } } };
};

test('56 worker entrega trabajo pendiente y marca SENT', async () => { const fake=workerPool(); let sent=0; await worker.processWebPushQueue({pool:fake.pool,sender:async()=>{sent++;},limit:2}); assert.equal(sent,1); assert.equal(fake.state.marks[0].status,'SENT'); });
test('57 fallo 410 desactiva dispositivo y queda permanente', async () => { const fake=workerPool(); await worker.processWebPushQueue({pool:fake.pool,sender:async()=>{const e=new Error('gone');e.statusCode=410;throw e;},limit:2}); assert.equal(fake.state.disabled,true); assert.equal(fake.state.marks[0].status,'FAILED_PERMANENT'); });
test('58 cuenta inactiva queda SUPERSEDED sin enviar', async () => { const fake=workerPool({account_active:false}); let sent=0; await worker.processWebPushQueue({pool:fake.pool,sender:async()=>{sent++;},limit:2}); assert.equal(sent,0); assert.equal(fake.state.marks[0].status,'SUPERSEDED'); });
test('59 error temporal programa reintento', async () => { const fake=workerPool(); await worker.processWebPushQueue({pool:fake.pool,sender:async()=>{const e=new Error('later');e.statusCode=503;throw e;},limit:2}); assert.equal(fake.state.marks[0].status,'FAILED_RETRY'); assert.ok(fake.state.marks[0].delay>0); });
test('60 el marcado del outbox tipa parametros para PostgreSQL real', () => { assert.match(workerSource,/status=\$2::varchar/); assert.match(workerSource,/last_error_code=\$3::varchar/); assert.match(workerSource,/CASE WHEN \$2::varchar='SENT'/); });
test('61 confirmación SIDRO informa el resultado concreto sin PII', () => { const p=JSON.parse(worker.buildPrivatePushPayload({type:'sidro_request_confirmed',recipient_type:'sidro_account',notification_id:61,data:{url:'/my-requests?open=61'},title:'Ana',body:'0999999999'})); assert.equal(p.notification.title,'Tu cita fue confirmada'); assert.match(p.notification.body,/fecha, la hora y la profesional/i); assert.doesNotMatch(JSON.stringify(p),/Ana|0999999999/); });
test('62 propuesta SIDRO explica la acción disponible', () => { const p=JSON.parse(worker.buildPrivatePushPayload({type:'sidro_request_proposal',recipient_type:'sidro_account',notification_id:62,data:{url:'/my-requests?open=62'}})); assert.equal(p.notification.title,'Tienes un nuevo horario propuesto'); assert.match(p.notification.body,/aceptarlo o rechazarlo/i); });
test('63 solicitud nueva avisa al POS con contexto útil', () => { const p=JSON.parse(worker.buildPrivatePushPayload({type:'sidro_request_created',recipient_type:'pos_user',notification_id:63,data:{url:'/citas/solicitudes?open=63'}})); assert.equal(p.notification.title,'Nueva solicitud de cita'); assert.match(p.notification.body,/servicio y el horario/i); });
test('64 consulta del worker incorpora el tipo de notificación', () => assert.match(workerSource,/notification\.type,notification\.recipient_type/));
