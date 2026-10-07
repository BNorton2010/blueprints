import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export async function verifyCloudflareResources(config, {
  apiToken = process.env.CLOUDFLARE_API_TOKEN,
  accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
  appOrigin = process.env.APP_ORIGIN || config.vars?.CLERK_AUTHORIZED_PARTIES,
  fetcher = globalThis.fetch,
} = {}) {
  if (config.name !== 'blueprints-library-dev' || config.routes || config.route || config.env || config.workers_dev !== true || config.d1_databases?.length !== 1 || config.r2_buckets?.length !== 1 || config.d1_databases[0].binding !== 'DB' || config.d1_databases[0].database_name !== 'blueprints-library-dev' || config.r2_buckets[0].binding !== 'BUCKET' || config.r2_buckets[0].bucket_name !== 'blueprints-library-dev-files') throw new Error('Only the separate development resources may be verified and deployed.');
  const token = apiToken?.trim();
  const account = accountId?.trim();
  if (!token || !/^[a-f0-9]{32}$/i.test(account || '')) throw new Error('Configure CLOUDFLARE_API_TOKEN and the correct CLOUDFLARE_ACCOUNT_ID securely before account verification.');
  if (config.account_id && config.account_id !== account) throw new Error('The configuration account_id does not match CLOUDFLARE_ACCOUNT_ID. No remote changes are allowed.');
  const databaseId = config.d1_databases[0].database_id;
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(databaseId || '') || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(databaseId)) throw new Error('Generate wrangler.dev.json using the UUID of the fresh development database.');
  async function read(path) {
    const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {headers: {authorization: 'Bearer ' + token}, signal: AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error(`Cloudflare read-only resource verification failed (${response.status}); check account access and the new resources.`);
    const data = await response.json();
    if (!data.success || !data.result) throw new Error('Cloudflare could not verify the new development resources.');
    return data.result;
  }
  const [database, bucket, subdomain] = await Promise.all([
    read('d1/database/' + databaseId),
    read('r2/buckets/blueprints-library-dev-files'),
    read('workers/subdomain'),
  ]);
  if (database.name !== 'blueprints-library-dev' || database.uuid !== databaseId) throw new Error('The database UUID does not identify blueprints-library-dev. No migration or deployment is allowed.');
  if (bucket.name !== 'blueprints-library-dev-files') throw new Error('The fresh development R2 bucket could not be verified.');
  if (!subdomain.subdomain || appOrigin !== `https://blueprints-library-dev.${subdomain.subdomain}.workers.dev`) throw new Error('APP_ORIGIN does not match this Cloudflare account’s separate development Worker address.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--config' || !args[1])) throw new Error('Usage: node scripts/cloudflare-check-account.mjs [--config PATH]');
    const path = args.length ? resolve(args[1]) : new URL('../wrangler.dev.json', import.meta.url);
    const config = JSON.parse(await readFile(path, 'utf8'));
    await verifyCloudflareResources(config);
    console.log('Verified the new development database, bucket, and account address using read-only requests.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
