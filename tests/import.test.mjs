import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareContent, applyContent } from '../scripts/import-content.mjs';

const id = '12345678-abcd-abcd-abcd-123456789abc';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');
const record = () => ({ id, title: 'Synthetic test framework', summary: 'This is test content.', points: ['One point'], application: ['One application'], content: 'The complete synthetic framework.', transcript: 'Blueprint teaching transcript only.', status: 'published', revision: 7, updatedAt: '2026-01-01T12:00:00.000Z', image: `/api/blueprints/${id}/image`, source: `/api/blueprints/${id}/source`, sourceMime: 'application/pdf', sourceName: 'original.pdf' });

function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'blueprints-import-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bundle = path.join(dir, 'bundle');
  const out = path.join(dir, 'output');
  mkdirSync(path.join(bundle, 'files'), { recursive: true });
  writeFileSync(path.join(bundle, 'files/image.png'), png);
  writeFileSync(path.join(bundle, 'files/original.pdf'), '%PDF-1.7\nSynthetic test fixture, not a real blueprint.');
  const item = record();
  const exports = { items: [item] };
  const assets = { version: 1, assets: { [id]: { image: 'files/image.png', source: 'files/original.pdf' } } };
  const save = () => { writeFileSync(path.join(bundle, 'blueprints.json'), JSON.stringify(exports)); writeFileSync(path.join(bundle, 'assets.json'), JSON.stringify(assets)); };
  save();
  return { dir, bundle, out, item, exports, assets, save };
}

function database(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const migrations = new URL('../drizzle/', import.meta.url);
  for (const file of readdirSync(migrations).filter(file => file.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(file, migrations), 'utf8'));
  db.exec("INSERT INTO chats (id, visitor, updated_at) VALUES ('private-chat','private-user','2026-01-01'); INSERT INTO quotas VALUES ('private-quota',42,9); INSERT INTO settings VALUES ('openai','encrypted-private-value'); INSERT INTO strategist_accounts (id) VALUES ('private-user');");
  return db;
}

test('upserts only blueprint content, repeats without revision changes, and preserves private data', t => {
  const f = fixture(t);
  f.item.title = "Creator's '; DELETE FROM chats; -- example";
  f.save();
  const first = prepareContent(f.bundle, f.out);
  assert.equal(first.manifest.blueprintCount, 1);
  assert.equal(first.manifest.assets.length, 2);
  assert.match(first.manifest.assets[0].key, /^blueprints\/[a-f0-9-]+\/[a-f0-9]{64}\.(pdf|png)$/);
  const db = database(t);
  db.exec(first.sql);
  const row = db.prepare('SELECT * FROM blueprints WHERE id=?').get(id);
  assert.equal(row.title, f.item.title);
  assert.equal(row.revision, 1);
  assert.equal(row.transcript, f.item.transcript);
  const repeat = prepareContent(f.bundle, f.out);
  assert.deepEqual(repeat.manifest, first.manifest);
  assert.equal(repeat.sql, first.sql);
  db.exec(repeat.sql);
  assert.equal(db.prepare('SELECT revision FROM blueprints WHERE id=?').get(id).revision, 1);
  f.item.summary = 'Changed synthetic summary.';
  f.save();
  db.exec(prepareContent(f.bundle, f.out).sql);
  assert.equal(db.prepare('SELECT revision FROM blueprints WHERE id=?').get(id).revision, 2);
  assert.equal(db.prepare('SELECT count(*) AS n FROM chats').get().n, 1);
  assert.equal(db.prepare('SELECT count FROM quotas').get().count, 42);
  assert.equal(db.prepare('SELECT value FROM settings').get().value, 'encrypted-private-value');
  assert.equal(db.prepare('SELECT id FROM strategist_accounts').get().id, 'private-user');
});

test('rejects whole databases and private fields rather than filtering them silently', t => {
  const f = fixture(t);
  for (const name of ['users', 'chats', 'quotas', 'settings', 'strategist_accounts']) {
    f.exports[name] = [];
    f.save();
    assert.throws(() => prepareContent(f.bundle, f.out), /Only blueprint content/);
    delete f.exports[name];
    f.item[name] = 'private';
    f.save();
    assert.throws(() => prepareContent(f.bundle, f.out), /Only blueprint content/);
    delete f.item[name];
  }
  writeFileSync(path.join(f.bundle, 'blueprints.json'), 'CREATE TABLE users (secret TEXT);');
  assert.throws(() => prepareContent(f.bundle, f.out), /SQL files and whole-database exports are not supported/);
  assert.equal(existsSync(f.out), false);
});

test('API URLs are references and every missing original or image blocks the whole import', t => {
  const f = fixture(t);
  delete f.assets.assets[id].source;
  f.save();
  assert.throws(() => prepareContent(f.bundle, f.out), /missing source file/);
  f.assets.assets[id].source = `/api/blueprints/${id}/source`;
  f.save();
  assert.throws(() => prepareContent(f.bundle, f.out), /relative local file/);
  f.assets.assets[id].source = 'files/not-present.pdf';
  f.save();
  assert.throws(() => prepareContent(f.bundle, f.out), /missing file/);
  assert.equal(existsSync(f.out), false);
});

test('forbids escaping file paths and symlinks', t => {
  const f = fixture(t);
  writeFileSync(path.join(f.dir, 'outside.pdf'), '%PDF-1.7');
  for (const source of ['../outside.pdf', path.join(f.dir, 'outside.pdf'), 'https://old-app.test/file.pdf']) {
    f.assets.assets[id].source = source;
    f.save();
    assert.throws(() => prepareContent(f.bundle, f.out), /relative local file/);
  }
  symlinkSync(path.join(f.dir, 'outside.pdf'), path.join(f.bundle, 'files/escape.pdf'));
  f.assets.assets[id].source = 'files/escape.pdf';
  f.save();
  assert.throws(() => prepareContent(f.bundle, f.out), /escapes the content bundle/);
});

test('validates bytes, file sizes, schema limits and duplicate IDs before producing output', t => {
  const f = fixture(t);
  writeFileSync(path.join(f.bundle, 'files/image.png'), '<svg onload="bad()"></svg>');
  assert.throws(() => prepareContent(f.bundle, f.out), /valid PNG/);
  writeFileSync(path.join(f.bundle, 'files/image.png'), Buffer.alloc(6 * 1024 * 1024 + 1));
  assert.throws(() => prepareContent(f.bundle, f.out), /at most 6 MiB/);
  writeFileSync(path.join(f.bundle, 'files/image.png'), png);
  f.item.points = Array.from({ length: 9 }, () => 'point');
  f.save();
  assert.throws(() => prepareContent(f.bundle, f.out), /eight/);
  f.item.points = ['point'];
  f.exports.items.push({ ...f.item });
  f.save();
  assert.throws(() => prepareContent(f.bundle, f.out), /unique, lowercase UUID/);
  assert.equal(existsSync(f.out), false);
});

test('explicitly rejects large SQL literal statements before any partial import', t => {
  const f = fixture(t);
  f.item.content = 'a'.repeat(60000);
  f.item.transcript = 'b'.repeat(60000);
  f.save();
  assert.throws(() => prepareContent(f.bundle, f.out), /95 KB SQL import statement limit/);
  assert.equal(existsSync(f.out), false);
});

test('preserves edited files and rejects symlinks in the prepared output', t => {
  const f = fixture(t);
  prepareContent(f.bundle, f.out);
  writeFileSync(path.join(f.out, 'blueprints.sql'), 'owner edited this file');
  assert.throws(() => prepareContent(f.bundle, f.out), /was edited/);
  assert.equal(readFileSync(path.join(f.out, 'blueprints.sql'), 'utf8'), 'owner edited this file');
  const linked = path.join(f.dir, 'linked-output');
  symlinkSync(f.out, linked);
  assert.throws(() => prepareContent(f.bundle, linked), /must not be a symlink/);
});

function config(f, overrides = {}) {
  const settings = { name: 'blueprints-library-dev', workers_dev: true, d1_databases: [{ binding: 'DB', database_name: 'blueprints-library-dev', database_id: '11223344-abcd-abcd-abcd-123456789abc' }], r2_buckets: [{ binding: 'BUCKET', bucket_name: 'blueprints-library-dev-files' }], ...overrides };
  const file = path.join(f.dir, 'wrangler.dev.json');
  writeFileSync(file, JSON.stringify(settings));
  return file;
}

test('remote upload verifies physical resources before files/database writes and never invokes a shell', t => {
  const f = fixture(t);
  const plan = prepareContent(f.bundle, f.out);
  const calls = [];
  applyContent(plan, { remote: true, config: config(f), runner: (file, args, options) => calls.push({ file, args, options }) });
  assert.equal(calls.length, 4);
  assert.equal(calls[0].file, process.execPath);
  assert.match(calls[0].args[0], /cloudflare-check-account\.mjs$/);
  assert.equal(calls[0].args[1], '--config');
  assert.equal(calls[1].args[0], 'r2');
  assert.equal(calls[2].args[0], 'r2');
  assert.equal(calls[3].args[0], 'd1');
  assert.ok(calls.slice(1).every(call => call.args.includes('--remote') && call.args.includes('--config') && !call.options.shell));
  assert.ok(calls.every(call => !call.options.shell));
  assert.equal(calls[3].args[2], 'DB');
});

test('failed read-only resource verification blocks every remote upload and SQL command', t => {
  const f = fixture(t);
  const plan = prepareContent(f.bundle, f.out);
  const calls = [];
  assert.throws(() => applyContent(plan, { remote: true, config: config(f), runner: (file, args) => {
    calls.push({ file, args });
    throw new Error('The database UUID does not identify the separate development database.');
  } }), /database UUID/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].args[0], /cloudflare-check-account\.mjs$/);
});

test('shared verifier CLI validates the explicit importer config rather than another default file', t => {
  const f = fixture(t);
  const file = config(f, { name: 'live-app' });
  const verifier = new URL('../scripts/cloudflare-check-account.mjs', import.meta.url);
  const result = spawnSync(process.execPath, [verifier.pathname, '--config', file], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Only the separate development resources/);
  assert.doesNotMatch(result.stderr, /ENOENT|Configure CLOUDFLARE_API_TOKEN/);
});

test('unsafe resource configuration and changed staged assets cannot trigger any commands', t => {
  const f = fixture(t);
  const plan = prepareContent(f.bundle, f.out);
  const runner = () => assert.fail('No command should execute before every check passes.');
  assert.throws(() => applyContent(plan, { remote: true, config: config(f, { name: 'live-app' }), runner }), /restricted to the separate/);
  assert.throws(() => applyContent(plan, { remote: true, config: config(f, { routes: ['blueprints.paidtobringpeace.com/*'] }), runner }), /restricted to the separate/);
  assert.throws(() => applyContent(plan, { remote: true, config: config(f, { env: { production: {} } }), runner }), /restricted to the separate/);
  assert.throws(() => applyContent(plan, { remote: true, config: config(f, { account_id: 'wrong-account' }), runner }), /restricted to the separate/);
  assert.throws(() => applyContent(plan, { remote: true, config: config(f, { d1_databases: [{ binding: 'DB', database_name: 'blueprints-library-dev', database_id: '00000000-0000-0000-0000-000000000000' }] }), runner }), /new development D1 database ID/);
  const safe = config(f);
  writeFileSync(path.join(plan.output, plan.manifest.assets[0].file), 'tampered');
  assert.throws(() => applyContent(plan, { remote: true, config: safe, runner }), /asset changed/);
});
