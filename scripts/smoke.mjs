import assert from 'node:assert/strict';

const base = process.env.SMOKE_ORIGIN || 'http://127.0.0.1:8787';
const origin = new URL(base);
if (origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password ||
    !(['localhost', '127.0.0.1'].includes(origin.hostname) ||
      (origin.protocol === 'https:' && /^blueprints-library-dev\.[a-z0-9-]+\.workers\.dev$/.test(origin.hostname)))) {
  throw Error('Smoke checks target only localhost or the separate development Worker.');
}
async function get(path, options) {
  return fetch(origin.origin + path, {signal: AbortSignal.timeout(10000), ...options});
}
for (const path of ['/', '/sign-in', '/app.js', '/auth.js', '/body.ttf', '/pdf.min.mjs']) {
  const response = await get(path);
  assert.equal(response.status, 200, path);
  assert.ok((await response.arrayBuffer()).byteLength > 0, path);
}
const session = await (await get('/api/session')).json();
assert.equal(session.signedIn, false);
assert.equal(session.admin, false);
assert.deepEqual(session.allowance, {limit: 100, used: 0, remaining: 100});
const catalog = await (await get('/api/blueprints')).json();
assert.ok(Array.isArray(catalog.items));
for (const item of catalog.items) {
  assert.equal('transcript' in item, false);
  assert.equal('content' in item, false);
}
assert.equal((await get('/api/admin/blueprints', {headers: {
  'oai-authenticated-user-id': 'pretend-owner', 'oai-authenticated-user-email': 'owner@example.com',
}})).status, 403);
assert.equal((await get('/api/chats', {method: 'POST', headers: {
  origin: origin.origin, 'content-type': 'application/json',
}, body: '{}'})).status, 401);
const admin = await get('/admin', {redirect: 'manual'});
assert.equal(admin.status, 302);
assert.equal(new URL(admin.headers.get('location')).pathname, '/sign-in');
console.log(`Smoke checks passed: static app, D1 public catalog (${catalog.items.length} records), fresh anonymous allowance, sign-in route, owner authorization, and chat gate.`);
