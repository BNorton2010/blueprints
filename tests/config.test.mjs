import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {verifyCloudflareResources} from '../scripts/cloudflare-check-account.mjs';

const script = await readFile(new URL('../scripts/cloudflare-config.mjs', import.meta.url), 'utf8');
const template = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const domain = 'independent-example.clerk.accounts.dev';
const baseline = {
  CLOUDFLARE_D1_DATABASE_ID: '12345678-abcd-abcd-abcd-123456789abc',
  APP_ORIGIN: 'https://blueprints-library-dev.example.workers.dev',
  CLERK_ISSUER: 'https://' + domain,
  CLERK_PUBLISHABLE_KEY: 'pk_test_' + Buffer.from(domain + '$').toString('base64url'),
  ADMIN_USER_IDS: 'user_owner123',
  OPENAI_MODEL: 'gpt-6-luna',
  OPENAI_TRANSCRIPTION_MODEL: 'gpt-4o-mini-transcribe',
};

async function run(overrides = {}, mutate, write = false) {
  const directory = await mkdtemp(join(tmpdir(), 'blueprints-config-'));
  try {
    await mkdir(join(directory, 'scripts'));
    const config = structuredClone(template);
    mutate?.(config);
    await writeFile(join(directory, 'scripts/cloudflare-config.mjs'), script);
    await writeFile(join(directory, 'wrangler.jsonc'), JSON.stringify(config));
    const result = spawnSync(process.execPath, [join(directory, 'scripts/cloudflare-config.mjs'), ...(write ? [] : ['--validate-only'])], {env: {...process.env, ...baseline, ...overrides}, encoding: 'utf8'});
    assert.ifError(result.error);
    return {...result, config: write && result.status === 0 ? JSON.parse(await readFile(join(directory, 'wrangler.dev.json'), 'utf8')) : null};
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

test('development configuration accepts matching new services and writes only public variables', async () => {
  const result = await run({OPENAI_API_KEY: 'never-write-this-secret'}, undefined, true);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.config.name, 'blueprints-library-dev');
  assert.equal(result.config.d1_databases[0].database_id, baseline.CLOUDFLARE_D1_DATABASE_ID);
  assert.equal(result.config.vars.CLERK_AUTHORIZED_PARTIES, baseline.APP_ORIGIN);
  assert.equal(result.config.vars.OPENAI_TRANSCRIPTION_MODEL, baseline.OPENAI_TRANSCRIPTION_MODEL);
  assert.equal('OPENAI_API_KEY' in result.config.vars, false);
  assert.ok(!JSON.stringify(result.config).includes('never-write-this-secret'));
});

test('development configuration rejects the existing public domain and other Worker names', async () => {
  for (const APP_ORIGIN of ['https://blueprints.paidtobringpeace.com', 'https://another-worker.example.workers.dev', 'http://blueprints-library-dev.example.workers.dev', 'https://blueprints-library-dev.example.workers.dev/admin']) {
    const result = await run({APP_ORIGIN});
    assert.notEqual(result.status, 0, APP_ORIGIN);
    assert.match(result.stderr, /APP_ORIGIN/);
  }
});

test('development configuration rejects placeholder IDs and mismatched Clerk applications', async () => {
  for (const CLOUDFLARE_D1_DATABASE_ID of ['', 'LOCAL_ONLY_CREATE_A_FRESH_DEV_DATABASE', '00000000-0000-0000-0000-000000000000']) assert.notEqual((await run({CLOUDFLARE_D1_DATABASE_ID})).status, 0);
  const mismatch = await run({CLERK_ISSUER: 'https://another-app.clerk.accounts.dev'});
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /same new Clerk application/);
});

test('development configuration rejects deployment templates with routes or reused resource names', async () => {
  const mutations = [
    config => { config.name = 'old-worker'; },
    config => { config.workers_dev = false; },
    config => { config.routes = ['blueprints.paidtobringpeace.com/*']; },
    config => { config.env = {production: {name: 'old-worker'}}; },
    config => { config.d1_databases[0].database_name = 'old-database'; },
    config => { config.r2_buckets[0].bucket_name = 'old-bucket'; },
  ];
  for (const mutate of mutations) {
    const result = await run({}, mutate);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /fresh, separate development/);
  }
});

test('remote verification checks the actual fresh resources using only read-only requests', async () => {
  const config = structuredClone(template);
  config.d1_databases[0].database_id = baseline.CLOUDFLARE_D1_DATABASE_ID;
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({url, options});
    let result;
    if (url.includes('/d1/database/')) result = {uuid: baseline.CLOUDFLARE_D1_DATABASE_ID, name: 'blueprints-library-dev'};
    else if (url.includes('/r2/buckets/')) result = {name: 'blueprints-library-dev-files'};
    else result = {subdomain: 'example'};
    return Response.json({success: true, result});
  };
  await verifyCloudflareResources(config, {apiToken: 'test-token', accountId: 'a'.repeat(32), appOrigin: baseline.APP_ORIGIN, fetcher});
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => !call.options.method || call.options.method === 'GET'));
  assert.ok(calls.every(call => call.url.startsWith('https://api.cloudflare.com/client/v4/accounts/')));
});

test('remote verification rejects an old physical D1 database and an account mismatch', async () => {
  const config = structuredClone(template);
  config.d1_databases[0].database_id = baseline.CLOUDFLARE_D1_DATABASE_ID;
  const options = {apiToken: 'test-token', accountId: 'a'.repeat(32), appOrigin: baseline.APP_ORIGIN, fetcher: async url => Response.json({success: true, result: url.includes('/d1/database/') ? {uuid: baseline.CLOUDFLARE_D1_DATABASE_ID, name: 'old-live-database'} : url.includes('/r2/buckets/') ? {name: 'blueprints-library-dev-files'} : {subdomain: 'example'}})};
  await assert.rejects(verifyCloudflareResources(config, options), /database UUID does not identify/);
  config.account_id = 'b'.repeat(32);
  let called = false;
  await assert.rejects(verifyCloudflareResources(config, {...options, fetcher: async () => { called = true; }}), /account_id does not match/);
  assert.equal(called, false);
});
