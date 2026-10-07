import {readFile, writeFile} from 'node:fs/promises';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} before preparing the separate development deployment.`);
  return value;
}

function origin(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an HTTPS origin.`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port) throw new Error(`${name} must be an HTTPS origin with no path, credentials, or port.`);
  return url.origin;
}

try {
  if (process.argv.slice(2).some(arg => arg !== '--validate-only')) throw new Error('Usage: node scripts/cloudflare-config.mjs [--validate-only]');
  const config = JSON.parse(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
  if (config.name !== 'blueprints-library-dev' || config.workers_dev !== true || config.routes || config.route || config.env || config.d1_databases?.length !== 1 || config.r2_buckets?.length !== 1 || config.d1_databases[0].binding !== 'DB' || config.d1_databases[0].database_name !== 'blueprints-library-dev' || config.r2_buckets[0].binding !== 'BUCKET' || config.r2_buckets[0].bucket_name !== 'blueprints-library-dev-files') throw new Error('The deployment template must target only the fresh, separate development Worker, database, and bucket.');
  if (config.account_id && config.account_id !== process.env.CLOUDFLARE_ACCOUNT_ID?.trim()) throw new Error('The template account_id must match CLOUDFLARE_ACCOUNT_ID.');
  const databaseId = required('CLOUDFLARE_D1_DATABASE_ID');
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(databaseId) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(databaseId)) throw new Error('CLOUDFLARE_D1_DATABASE_ID must be the UUID of the newly created development database.');
  const appOrigin = origin(required('APP_ORIGIN'), 'APP_ORIGIN');
  if (!/^blueprints-library-dev\.[a-z0-9-]+\.workers\.dev$/i.test(new URL(appOrigin).hostname)) throw new Error('APP_ORIGIN must be the separate blueprints-library-dev.<account-subdomain>.workers.dev address. Custom domains are excluded from this phase.');
  const issuer = origin(required('CLERK_ISSUER'), 'CLERK_ISSUER');
  const publishableKey = required('CLERK_PUBLISHABLE_KEY');
  if (!/^pk_(?:test|live)_[A-Za-z0-9_-]+$/.test(publishableKey)) throw new Error('CLERK_PUBLISHABLE_KEY must be the publishable key for the new Clerk application.');
  const encodedHost = publishableKey.replace(/^pk_(?:test|live)_/, '');
  const decodedHost = Buffer.from(encodedHost, 'base64').toString('utf8');
  if (!decodedHost.endsWith('$') || decodedHost.slice(0, -1) !== new URL(issuer).host) throw new Error('CLERK_PUBLISHABLE_KEY and CLERK_ISSUER must identify the same new Clerk application.');
  const adminIds = required('ADMIN_USER_IDS').split(',').map(value => value.trim()).filter(Boolean);
  if (!adminIds.length || adminIds.some(value => !/^user_[A-Za-z0-9]+$/.test(value))) throw new Error('ADMIN_USER_IDS must contain only Clerk user IDs, separated by commas.');
  const model = (process.env.OPENAI_MODEL || config.vars?.OPENAI_MODEL || '').trim();
  if (!model || model.length > 100 || !/^[A-Za-z0-9._:-]+$/.test(model)) throw new Error('OPENAI_MODEL must name a Responses API model available in your OpenAI project.');
  const transcriptionModel = (process.env.OPENAI_TRANSCRIPTION_MODEL || config.vars?.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe').trim();
  if (!transcriptionModel || transcriptionModel.length > 100 || !/^[A-Za-z0-9._:-]+$/.test(transcriptionModel)) throw new Error('OPENAI_TRANSCRIPTION_MODEL must name an audio transcription model available in your OpenAI project.');
  config.d1_databases[0].database_id = databaseId;
  config.vars = {OPENAI_MODEL: model, OPENAI_TRANSCRIPTION_MODEL: transcriptionModel, CLERK_ISSUER: issuer, CLERK_PUBLISHABLE_KEY: publishableKey, CLERK_AUTHORIZED_PARTIES: appOrigin, ADMIN_USER_IDS: [...new Set(adminIds)].join(',')};
  if (process.env.CLERK_AUDIENCE?.trim()) config.vars.CLERK_AUDIENCE = process.env.CLERK_AUDIENCE.trim();
  if (process.argv.includes('--validate-only')) {
    console.log('Separate development deployment configuration validated.');
  } else {
    await writeFile(new URL('../wrangler.dev.json', import.meta.url), JSON.stringify(config, null, 2) + '\n');
    console.log('Prepared ignored wrangler.dev.json for the separate development Worker. No secrets were written.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
