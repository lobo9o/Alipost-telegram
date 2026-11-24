import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';

process.env.DATABASE_URL = 'postgres://localhost/test-non-usato';
process.env.TELEGRAM_BOT_TOKEN = '123:test-token';
process.env.CRON_SECRET = 'segreto-di-test';
delete process.env.ALLOW_UNVERIFIED_TELEGRAM;

const { requireUserId, getUserId, isInternalRequest, isAuthorizedJob, safeEqual } = await import('../api/_utils.js');
const { internalHeaders, INTERNAL_AUTH_HEADER } = await import('../lib/internalAuth.js');
const quiz = (await import('../api/quiz/index.js')).default;
const admin = (await import('../api/admin/dashboard.js')).default;
const recap = (await import('../api/autopost/daily-recap.js')).default;

const LOCAL = { ip: '127.0.0.1' };
const LOCALHOST = { host: 'localhost:3000' };
const INTERNAL = { ...LOCALHOST, ...internalHeaders() };
const TUNNEL = { host: 'postdealbot.it', 'cf-connecting-ip': '203.0.113.9', 'cf-ray': 'abc', 'x-forwarded-for': '203.0.113.9' };
function mkReq(headers: any, extra: any = {}) { return { headers, query: {}, method: 'GET', socket: {}, ...LOCAL, ...extra } as any; }
function mkRes() { const r: any = { code: 200, body: null, status(c: number) { r.code = c; return r; }, json(b: any) { r.body = b; return r; }, send(b: any) { r.body = b; return r; }, setHeader() {} }; return r; }
function initData(userId: number, ageSec = 0, token = process.env.TELEGRAM_BOT_TOKEN!) {
  const p = new URLSearchParams({ user: JSON.stringify({ id: userId }), auth_date: String(Math.floor(Date.now() / 1000) - ageSec) });
  const dcs = [...p.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  p.set('hash', crypto.createHmac('sha256', key).update(dcs).digest('hex'));
  return p.toString();
}

test('x-internal-user-id: dal Tunnel viene rifiutato anche se il socket è locale', () => {
  const res = mkRes();
  assert.equal(requireUserId(mkReq({ ...TUNNEL, 'x-internal-user-id': '54225500' }), res), null);
  assert.equal(res.code, 401);
});
test('x-internal-user-id: accettato per il worker interno (token del processo)', () => {
  assert.equal(requireUserId(mkReq({ ...INTERNAL, 'x-internal-user-id': '777' }), mkRes()), '777');
  assert.deepEqual(Object.keys(internalHeaders('777', true)).sort(), ['Content-Type', INTERNAL_AUTH_HEADER, 'x-internal-user-id'].sort());
});
test('x-internal-user-id: dal socket locale SENZA token viene rifiutato', () => {
  const res = mkRes();
  assert.equal(requireUserId(mkReq({ ...LOCALHOST, 'x-internal-user-id': '777' }), res), null);
  assert.equal(res.code, 401);
});
test('x-internal-user-id: token interno errato o vuoto rifiutato', () => {
  for (const t of ['sbagliato', '', 'x'.repeat(43)]) assert.equal(requireUserId(mkReq({ ...LOCALHOST, [INTERNAL_AUTH_HEADER]: t, 'x-internal-user-id': '777' }), mkRes()), null);
});
test('x-internal-user-id: token valido ma arrivato dal Tunnel rifiutato (difesa in profondità)', () => {
  assert.equal(requireUserId(mkReq({ ...TUNNEL, ...internalHeaders(), 'x-internal-user-id': '777' }), mkRes()), null);
});
test('token interno: uguale fra copie diverse del modulo nello stesso processo', async () => {
  const altra = await import('../lib/internalAuth.ts?copia=' + Date.now());
  assert.equal(altra.internalHeaders()[INTERNAL_AUTH_HEADER], internalHeaders()[INTERNAL_AUTH_HEADER]);
});
test('x-internal-user-id: rifiutato con Host pubblico senza header proxy', () => {
  assert.equal(requireUserId(mkReq({ host: 'postdealbot.it', 'x-internal-user-id': '1' }), mkRes()), null);
});
test('x-internal-user-id: rifiutato da IP esterno', () => {
  assert.equal(requireUserId(mkReq({ ...INTERNAL, 'x-internal-user-id': '1' }, { ip: '203.0.113.9' }), mkRes()), null);
});
test('CRON_SECRET: apre solo le funzioni pianificate, non permette di agire per conto di un utente', () => {
  assert.equal(requireUserId(mkReq({ ...TUNNEL, 'x-internal-user-id': '5', authorization: 'Bearer segreto-di-test' }), mkRes()), null);
  assert.equal(isAuthorizedJob(mkReq({ ...TUNNEL, authorization: 'Bearer segreto-di-test' })), true);
  assert.equal(isAuthorizedJob(mkReq({ ...TUNNEL, authorization: 'Bearer sbagliato' })), false);
  assert.equal(isAuthorizedJob(mkReq({ ...LOCALHOST })), false);
  assert.equal(isAuthorizedJob(mkReq({ ...INTERNAL })), true);
});
test('Telegram: firma valida', () => { assert.equal(getUserId(mkReq({ 'x-tg-init-data': initData(42) })), '42'); });
test('Telegram: firma falsa rifiutata', () => { assert.equal(getUserId(mkReq({ 'x-tg-init-data': initData(42, 0, '999:altro') })), null); });
test('Telegram: dati scaduti rifiutati', () => { assert.equal(getUserId(mkReq({ 'x-tg-init-data': initData(42, 90000) })), null); });
test('Telegram: senza bot token non si accetta nulla', () => {
  const t = process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_BOT_TOKEN;
  try { assert.equal(getUserId(mkReq({ 'x-tg-init-data': initData(42, 0, 'x') })), null); } finally { process.env.TELEGRAM_BOT_TOKEN = t; }
});
test('Telegram: un profilo altrui non si può impersonare', () => {
  assert.equal(getUserId(mkReq({ 'x-tg-init-data': initData(42), 'x-profile-id': '99:canale' })), '42');
  assert.equal(getUserId(mkReq({ 'x-tg-init-data': initData(42), 'x-profile-id': '42:canale' })), '42:canale');
});
test('safeEqual', () => { assert.ok(safeEqual('a', 'a')); assert.ok(!safeEqual('a', 'b')); });

test('quiz: header forgiato dal Tunnel → 401 prima di toccare il database', async () => {
  const res = mkRes(); await quiz(mkReq({ ...TUNNEL, 'x-internal-user-id': '54225500' }), res); assert.equal(res.code, 401);
});
test('quiz: ?userId= non basta più', async () => {
  const res = mkRes(); await quiz(mkReq({ ...TUNNEL }, { query: { userId: '54225500' } }), res); assert.equal(res.code, 401);
});
test('admin: senza ADMIN_PASSWORD resta chiuso, anche con la vecchia password', async () => {
  delete process.env.ADMIN_PASSWORD;
  const res = mkRes(); await admin(mkReq(TUNNEL, { method: 'POST', body: { password: 'postdealadmin' } }), res); assert.equal(res.code, 503);
});
test('admin: password errata o non testuale → 401', async () => {
  process.env.ADMIN_PASSWORD = 'giusta';
  for (const password of ['errata', 'postdealadmin', ['giusta'], undefined]) { const res = mkRes(); await admin(mkReq(TUNNEL, { method: 'POST', body: { password } }), res); assert.equal(res.code, 401); }
});
test('riepilogo: dall\'esterno non si avvia per un userId scelto', async () => {
  const res = mkRes(); await recap(mkReq(TUNNEL, { method: 'POST', body: { userId: '54225500' } }), res); assert.equal(res.code, 401);
  const r2 = mkRes(); await recap(mkReq(TUNNEL), r2); assert.equal(r2.code, 401);
});

test('connessione reale: Tunnel simulato su socket locale', async () => {
  const app = express();
  app.get('/p', (req: any, res: any) => { const id = requireUserId(req, res); if (id) res.json({ id, internal: isInternalRequest(req), job: isAuthorizedJob(req) }); });
  const srv = http.createServer(app); await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as any).port;
  const call = (headers: any) => new Promise<any>((ok, no) => { http.get({ host: '127.0.0.1', port, path: '/p', headers }, (r) => { let b = ''; r.on('data', d => b += d); r.on('end', () => ok({ code: r.statusCode, body: b })); }).on('error', no); });
  try {
    assert.equal((await call({ host: 'postdealbot.it', 'cf-connecting-ip': '203.0.113.9', 'x-internal-user-id': '54225500' })).code, 401);
    assert.equal((await call({ host: 'localhost:' + port, 'x-internal-user-id': '777' })).code, 401);
    const inner = await call({ host: 'localhost:' + port, ...internalHeaders('777') });
    assert.equal(inner.code, 200); assert.equal(JSON.parse(inner.body).id, '777');
  } finally { srv.close(); }
});

const { upstreamDetail, redactSecrets } = await import('../lib/redact.js');
test('errori dei servizi esterni: solo codice e messaggio, segreti oscurati', () => {
  assert.equal(upstreamDetail('{"error":"invalid_client","error_description":"Client authentication failed"}'), ': invalid_client · Client authentication failed');
  const finto = 'Atc|' + 'Q'.repeat(60);
  for (const body of [`{"access_token":"${finto}","error":"x"}`, `access_token=${finto}`, `Bearer ${finto}`, `{"message":"client_secret=abc123 rifiutato"}`, `<html>${'Z'.repeat(80)}</html>`]) {
    const d = upstreamDetail(body) + redactSecrets(body);
    assert.ok(!d.includes('QQQQQQQQ') && !d.includes('abc123') && !d.includes('ZZZZZZZZ'), d);
  }
  assert.ok(upstreamDetail('x'.repeat(5000)).length <= 162);
  assert.equal(upstreamDetail(''), '');
});
