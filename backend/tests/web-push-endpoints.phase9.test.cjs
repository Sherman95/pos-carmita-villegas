const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'phase9-endpoints-test-secret-at-least-32-characters';
process.env.WEB_PUSH_ENABLED = 'true';
process.env.VAPID_PUBLIC_KEY = 'test-public';
process.env.VAPID_PRIVATE_KEY = 'test-private';
process.env.VAPID_SUBJECT = 'mailto:test@example.invalid';

const ids = {
  pos: '11111111-1111-4111-8111-111111111111',
  inactivePos: '22222222-2222-4222-8222-222222222222',
  sidro: '33333333-3333-4333-8333-333333333333',
  otherSidro: '44444444-4444-4444-8444-444444444444'
};
const state = { subscriptions: [], outbox: [], nextId: 1 };

const query = async (sql, params = []) => {
  const text = String(sql).replace(/\s+/g,' ').trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(text)) return {rows:[],rowCount:0};
  if (/FROM users WHERE id = \$1 LIMIT 1/i.test(text)) {
    if (params[0] === ids.inactivePos) return {rows:[{id:params[0],username:'off',role:'owner',active:false,token_version:0,must_change_password:false}],rowCount:1};
    if (params[0] === ids.pos) return {rows:[{id:params[0],username:'owner',role:'owner',active:true,token_version:0,must_change_password:false}],rowCount:1};
    return {rows:[],rowCount:0};
  }
  if (/FROM sidro_client_accounts WHERE id = \$1 LIMIT 1/i.test(text)) {
    if ([ids.sidro,ids.otherSidro].includes(params[0])) return {rows:[{id:params[0],is_active:true,token_version:0}],rowCount:1};
    return {rows:[],rowCount:0};
  }
  if (/SELECT id, subscriber_type, subscriber_id FROM push_subscriptions WHERE endpoint=\$1 FOR UPDATE/i.test(text)) {
    const found=state.subscriptions.find(x=>x.endpoint===params[0]); return {rows:found?[found]:[],rowCount:found?1:0};
  }
  if (/INSERT INTO push_subscriptions/i.test(text)) {
    let found=state.subscriptions.find(x=>x.endpoint===params[2]);
    const inserted=!found;
    if (!found) { found={id:state.nextId++,endpoint:params[2]}; state.subscriptions.push(found); }
    Object.assign(found,{subscriber_type:params[0],subscriber_id:String(params[1]),p256dh:params[3],auth:params[4],token_version:params[5],disabled_at:null});
    return {rows:[{id:found.id,inserted}],rowCount:1};
  }
  if (/UPDATE push_outbox SET status='SUPERSEDED'/i.test(text)) return {rows:[],rowCount:0};
  if (/UPDATE push_subscriptions SET disabled_at=NOW\(\)/i.test(text)) {
    const found=state.subscriptions.find(x=>x.endpoint===params[0]&&x.subscriber_type===params[1]&&x.subscriber_id===String(params[2])&&!x.disabled_at);
    if(found) found.disabled_at=new Date().toISOString();
    return {rows:found?[{id:found.id}]:[],rowCount:found?1:0};
  }
  return {rows:[],rowCount:0};
};
const fakePool={on(){},query,async connect(){return{query,release(){}}}};
const dbPath=require.resolve('../dist/database/db.js');
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{__esModule:true,default:fakePool}};

const posRoutes=require('../dist/routes/notifications.routes.js').default;
const sidroRoutes=require('../dist/routes/sidro.routes.js').default;
const app=express(); app.use(express.json()); app.use('/api/notifications',posRoutes); app.use('/api/sidro',sidroRoutes);
let server; let base;
test.before(async()=>{await new Promise(resolve=>{server=app.listen(0,'127.0.0.1',()=>{base=`http://127.0.0.1:${server.address().port}`;resolve();});});});
test.after(async()=>{await new Promise(resolve=>server.close(resolve));});
test.beforeEach(()=>{state.subscriptions.length=0;state.outbox.length=0;state.nextId=1;});

const token=(id,identity)=>jwt.sign({sub:id,role:identity==='sidro_client'?'sidro_client':'owner',identity_type:identity,token_version:0},process.env.JWT_SECRET,{algorithm:'HS256',issuer:'pos-carmita-villegas',audience:identity==='sidro_client'?'sidro':'pos',expiresIn:'10m'});
const subscription=(suffix='one')=>({endpoint:`https://push.example.invalid/${suffix}`,keys:{p256dh:'A'.repeat(64),auth:'B'.repeat(24)}});
const request=(path,method,jwtToken,body)=>fetch(`${base}${path}`,{method,headers:{Authorization:`Bearer ${jwtToken}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}).then(async r=>({status:r.status,body:await r.json()}));

test('01 POS registra una suscripción atribuida al JWT',async()=>{const r=await request('/api/notifications/subscriptions','POST',token(ids.pos,'pos_staff'),{...subscription(),subscriber_id:ids.sidro});assert.equal(r.status,201);assert.equal(state.subscriptions[0].subscriber_id,ids.pos);assert.equal(state.subscriptions[0].subscriber_type,'pos_user');});
test('02 SIDRO registra una suscripción atribuida al JWT',async()=>{const r=await request('/api/sidro/notifications/subscriptions','POST',token(ids.sidro,'sidro_client'),subscription());assert.equal(r.status,201);assert.equal(state.subscriptions[0].subscriber_id,ids.sidro);assert.equal(state.subscriptions[0].subscriber_type,'sidro_account');});
test('03 token SIDRO no administra suscripciones POS',async()=>assert.equal((await request('/api/notifications/subscriptions','POST',token(ids.sidro,'sidro_client'),subscription())).status,403));
test('04 token POS no administra suscripciones SIDRO',async()=>assert.equal((await request('/api/sidro/notifications/subscriptions','POST',token(ids.pos,'pos_staff'),subscription())).status,403));
test('05 una cuenta puede registrar varios dispositivos',async()=>{const t=token(ids.pos,'pos_staff');await request('/api/notifications/subscriptions','POST',t,subscription('one'));await request('/api/notifications/subscriptions','POST',t,subscription('two'));assert.equal(state.subscriptions.length,2);});
test('06 renovar endpoint no duplica fila',async()=>{const t=token(ids.sidro,'sidro_client');await request('/api/sidro/notifications/subscriptions','POST',t,subscription());await request('/api/sidro/notifications/subscriptions','POST',t,subscription());assert.equal(state.subscriptions.length,1);});
test('07 propietario puede revocar su endpoint',async()=>{const t=token(ids.pos,'pos_staff');await request('/api/notifications/subscriptions','POST',t,subscription());const r=await request('/api/notifications/subscriptions','DELETE',t,{endpoint:subscription().endpoint});assert.equal(r.body.changed,true);assert.ok(state.subscriptions[0].disabled_at);});
test('08 una cuenta no revoca el endpoint ajeno',async()=>{await request('/api/sidro/notifications/subscriptions','POST',token(ids.sidro,'sidro_client'),subscription());const r=await request('/api/sidro/notifications/subscriptions','DELETE',token(ids.otherSidro,'sidro_client'),{endpoint:subscription().endpoint});assert.equal(r.body.changed,false);assert.equal(state.subscriptions[0].disabled_at,null);});
test('09 cuenta inactiva no registra Push',async()=>assert.equal((await request('/api/notifications/subscriptions','POST',token(ids.inactivePos,'pos_staff'),subscription())).status,401));
test('10 endpoint HTTP malicioso se rechaza',async()=>{const bad={...subscription(),endpoint:'http://evil.example/sub'};assert.equal((await request('/api/notifications/subscriptions','POST',token(ids.pos,'pos_staff'),bad)).status,400);});
