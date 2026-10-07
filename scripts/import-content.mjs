import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_FILE = 6 * 1024 * 1024;
const RECORD_KEYS = ['id', 'title', 'summary', 'points', 'application', 'content', 'transcript', 'image', 'source', 'sourceName', 'sourceMime', 'status', 'revision', 'updatedAt'];
const CONTENT_COLUMNS = ['title', 'summary', 'points', 'application', 'content', 'transcript', 'image_key', 'source_key', 'source_name', 'source_mime', 'status'];
const TARGET = { worker: 'blueprints-library-dev', database: 'blueprints-library-dev', bucket: 'blueprints-library-dev-files' };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };

function object(value, label, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a JSON object, not a database dump.`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${label}: unexpected field ${key}. Only blueprint content is accepted; users, chats, quotas, settings, and accounts cannot be imported.`);
  return value;
}

function text(value, max, label, required = false) {
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || (required && !value.trim())) fail(`${label} must be ${required ? 'nonempty ' : ''}text of at most ${max} characters.`);
  return value.trim();
}

function bullets(value, label) {
  if (!Array.isArray(value) || value.length > 8) fail(`${label} must contain at most eight short text items.`);
  return value.map((entry, index) => text(entry, 1000, `${label}[${index}]`)).filter(Boolean);
}

function containedFile(root, relative, label) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..') || /^[a-z]+:/i.test(relative)) fail(`${label} must be a relative local file inside the content bundle, not a URL or API route.`);
  const candidate = path.resolve(root, relative);
  let resolved;
  try { resolved = realpathSync(candidate); } catch { fail(`${label}: missing file ${relative}. Download the actual image/document into the content bundle.`); }
  const rel = path.relative(root, resolved);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) fail(`${label} escapes the content bundle (including through a symlink).`);
  if (!statSync(resolved).isFile()) fail(`${label} is not a regular file.`);
  return resolved;
}

function jsonFile(root, name) {
  const file = containedFile(root, name, name);
  if (statSync(file).size > 50 * 1024 * 1024) fail(`${name} is larger than 50 MiB.`);
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { fail(`${name} is not valid JSON. SQL files and whole-database exports are not supported.`); }
}

function fileType(bytes, role) {
  if (role === 'source' && bytes.subarray(0, 5).toString() === '%PDF-') return { mime: 'application/pdf', extension: 'pdf' };
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: 'image/png', extension: 'png' };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { mime: 'image/jpeg', extension: 'jpg' };
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
  fail(`${role} must be a valid PNG, JPEG, or WebP${role === 'source' ? ', or a PDF original document' : ''}.`);
}

function exportReference(value, id, role) {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'string' || !value) fail(`${id}.${role} must be an exported API URL or null.`);
  let url;
  try { url = new URL(value, 'https://content-export.invalid'); } catch { fail(`${id}.${role} is not an exported API URL.`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== `/api/blueprints/${id}/${role}` || url.search || url.hash || url.username || url.password) fail(`${id}.${role} must be an exported blueprint API URL. Put local filenames in assets.json instead.`);
  return true;
}

function sqlValue(value) {
  return value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
}

function sqlRow(row) {
  const timestamp = row.timestamp ? sqlValue(row.timestamp) : "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  const columns = ['id', ...CONTENT_COLUMNS, 'revision', 'created_at', 'updated_at'];
  const values = [sqlValue(row.id), ...CONTENT_COLUMNS.map(column => sqlValue(row[column])), '1', timestamp, timestamp];
  const set = CONTENT_COLUMNS.map(column => `${column}=excluded.${column}`).concat('revision=blueprints.revision+1', "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  const changes = CONTENT_COLUMNS.map(column => `blueprints.${column} IS NOT excluded.${column}`);
  return `INSERT INTO blueprints (${columns.join(',')}) VALUES (${values.join(',')})\nON CONFLICT(id) DO UPDATE SET ${set.join(',')}\nWHERE ${changes.join(' OR ')};`;
}

/** Validate everything before writing anything. Source records are never evaluated or fetched. */
export function prepareContent(bundleDirectory, outputDirectory) {
  const root = realpathSync(path.resolve(bundleDirectory));
  const exported = object(jsonFile(root, 'blueprints.json'), 'blueprints.json', ['items']);
  if (!Array.isArray(exported.items) || !exported.items.length || exported.items.length > 10000) fail('blueprints.json.items must contain between one and 10,000 blueprint records.');
  let files = {};
  if (existsSync(path.join(root, 'assets.json'))) {
    const manifest = object(jsonFile(root, 'assets.json'), 'assets.json', ['version', 'assets']);
    if (manifest.version !== 1) fail('assets.json.version must be 1.');
    files = object(manifest.assets, 'assets.json.assets', exported.items.map(item => item?.id));
  }
  const rows = [];
  const assets = new Map();
  const seen = new Set();
  for (const raw of exported.items) {
    const item = object(raw, 'blueprint', RECORD_KEYS);
    if (typeof item.id !== 'string' || !UUID.test(item.id) || seen.has(item.id)) fail('Each blueprint must have a unique, lowercase UUID id. Keep the original UUID for repeatable imports.');
    const id = item.id;
    seen.add(id);
    if (!['draft', 'published'].includes(item.status)) fail(`${id}.status must be draft or published.`);
    const row = {
      id, title: text(item.title, 200, `${id}.title`, true), summary: text(item.summary ?? '', 3000, `${id}.summary`),
      points: JSON.stringify(bullets(item.points ?? [], `${id}.points`)), application: JSON.stringify(bullets(item.application ?? [], `${id}.application`)),
      content: text(item.content ?? '', 60000, `${id}.content`), transcript: text(item.transcript ?? '', 120000, `${id}.transcript`),
      image_key: null, source_key: null, source_name: null, source_mime: null, status: item.status, timestamp: null,
    };
    if (row.status === 'published' && !row.summary) fail(`${id}: a published blueprint needs a summary.`);
    if (item.revision !== undefined && (!Number.isInteger(item.revision) || item.revision < 1)) fail(`${id}.revision must be a positive integer. Source revisions are validated but not copied.`);
    if (item.updatedAt !== undefined && item.updatedAt !== null) {
      if (typeof item.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(item.updatedAt) || Number.isNaN(Date.parse(item.updatedAt))) fail(`${id}.updatedAt must be an ISO UTC timestamp.`);
      row.timestamp = new Date(item.updatedAt).toISOString();
    }
    const mapped = object(files[id] ?? {}, `assets for ${id}`, ['image', 'source']);
    for (const role of ['image', 'source']) {
      const reference = exportReference(item[role], id, role);
      if (reference && !mapped[role]) fail(`${id}: missing ${role} file. The export's API URL does not contain the file; add its local path to assets.json.`);
      if (mapped[role] === undefined) continue;
      const source = containedFile(root, mapped[role], `${id}.${role}`);
      const size = statSync(source).size;
      if (!size || size > MAX_FILE) fail(`${id}.${role} must be nonempty and at most 6 MiB.`);
      const bytes = readFileSync(source);
      const { mime, extension } = fileType(bytes, role);
      const hash = sha256(bytes);
      const key = `blueprints/${id}/${hash}.${extension}`;
      const staged = `assets/${hash}.${extension}`;
      assets.set(key, { key, file: staged, sha256: hash, size, mime, source });
      row[`${role}_key`] = key;
      if (role === 'source') {
        row.source_name = text(item.sourceName ?? path.basename(source), 200, `${id}.sourceName`, true);
        row.source_mime = mime;
        if (item.sourceMime !== undefined && item.sourceMime !== null && item.sourceMime !== mime) fail(`${id}.sourceMime does not match the original document's bytes.`);
      }
    }
    if (!row.source_key && (item.sourceName || item.sourceMime)) fail(`${id}: source metadata exists but its original document is missing. Add assets.json source mapping.`);
    if (row.status === 'published' && (row.source_key || row.transcript) && !row.content) fail(`${id}: a published source/transcript needs extracted framework content. Export the complete Admin record, not the public catalog.`);
    rows.push(row);
  }
  rows.sort((a, b) => a.id.localeCompare(b.id));
  const statements = rows.map(row => {
    const statement = sqlRow(row);
    // Wrangler sends SQL literals. D1 limits a SQL statement to 100,000 bytes.
    if (Buffer.byteLength(statement, 'utf8') > 95000) fail(`${row.id}: content exceeds the safe 95 KB SQL import statement limit. Add this blueprint through the new app's Admin editor, which uses bound parameters, or import a smaller content bundle. Nothing has been written.`);
    return statement;
  });
  const sql = '-- Blueprint content only. No users, conversations, quotas, credentials, or account data.\n' + statements.join('\n\n') + '\n';
  const ordered = [...assets.values()].sort((a, b) => a.key.localeCompare(b.key));
  const manifest = { kind: 'blueprint-content-import', version: 1, blueprintCount: rows.length, sqlFile: 'blueprints.sql', sqlSha256: sha256(sql), assets: ordered.map(({ source, ...entry }) => entry) };
  const output = path.resolve(outputDirectory);
  if (output === root || !path.relative(root, output).startsWith('..')) fail('Import output must be outside the source content bundle.');
  if (existsSync(output)) {
    if (lstatSync(output).isSymbolicLink()) fail('Output directory must not be a symlink. Choose a new directory.');
    const marker = path.join(output, 'manifest.json');
    if (!existsSync(marker)) fail('Output directory already exists without an import marker. Choose a new .local/import directory to preserve existing files.');
    let previous;
    try { previous = JSON.parse(readFileSync(marker, 'utf8')); } catch { fail('Existing output has an invalid import marker. Choose a new directory.'); }
    if (previous.kind !== manifest.kind || previous.version !== 1) fail('Output contains other data. Choose a new directory.');
    const previousSql = containedFile(output, 'blueprints.sql', 'existing prepared SQL');
    if (sha256(readFileSync(previousSql)) !== previous.sqlSha256) fail('Existing prepared SQL was edited. Choose a new output directory to preserve it.');
    for (const asset of previous.assets ?? []) {
      const previousFile = containedFile(output, asset.file, 'existing prepared asset');
      if (sha256(readFileSync(previousFile)) !== asset.sha256) fail('Existing prepared assets were edited. Choose a new output directory to preserve them.');
    }
  }
  for (const relative of ['manifest.json', 'blueprints.sql', 'assets', ...ordered.map(asset => asset.file)]) {
    const destination = path.join(output, relative);
    if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) fail('Generated output paths must not be symlinks. Choose a new output directory.');
  }
  mkdirSync(path.join(output, 'assets'), { recursive: true });
  for (const asset of ordered) {
    const bytes = readFileSync(asset.source);
    if (sha256(bytes) !== asset.sha256) fail('A source asset changed during preparation. Prepare the import again.');
    writeFileSync(path.join(output, asset.file), bytes);
  }
  writeFileSync(path.join(output, 'blueprints.sql'), sql);
  writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { output, manifest, sql };
}

export function applyContent(plan, { remote = false, config, runner = execFileSync } = {}) {
  const configuration = path.resolve(config ?? path.join(ROOT, remote ? 'wrangler.dev.json' : 'wrangler.jsonc'));
  let settings;
  try { settings = JSON.parse(readFileSync(configuration, 'utf8')); } catch { fail('Import requires a plain JSON Wrangler config. Generate wrangler.dev.json for remote development.'); }
  const db = settings.d1_databases?.find(binding => binding.binding === 'DB');
  const bucket = settings.r2_buckets?.find(binding => binding.binding === 'BUCKET');
  if (settings.name !== TARGET.worker || settings.workers_dev !== true || settings.route || settings.routes || settings.env || settings.d1_databases?.length !== 1 || settings.r2_buckets?.length !== 1 || db?.database_name !== TARGET.database || bucket?.bucket_name !== TARGET.bucket || (settings.account_id && settings.account_id !== process.env.CLOUDFLARE_ACCOUNT_ID)) fail('Import is restricted to the separate blueprints-library-dev Worker, database, and bucket, without routes, environments, or account overrides. Never target the live Sites application.');
  if (remote && (!UUID.test(db.database_id ?? '') || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(db.database_id))) fail('Remote import needs the new development D1 database ID in wrangler.dev.json.');
  const output = realpathSync(plan.output);
  const sql = containedFile(output, plan.manifest.sqlFile, 'prepared SQL');
  if (sha256(readFileSync(sql)) !== plan.manifest.sqlSha256) fail('Prepared SQL changed after validation. Prepare the import again.');
  const uploads = plan.manifest.assets.map(asset => {
    const file = containedFile(output, asset.file, 'prepared asset');
    if (sha256(readFileSync(file)) !== asset.sha256) fail('A prepared asset changed after validation. Prepare the import again.');
    return { ...asset, file };
  });
  const executable = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
  const mode = remote ? '--remote' : '--local';
  const execution = { cwd: ROOT, stdio: 'inherit', env: { ...process.env, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || path.join(ROOT, '.local/config'), WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH || path.join(ROOT, '.local/wrangler-logs'), WRANGLER_SEND_METRICS: process.env.WRANGLER_SEND_METRICS || 'false' } };
  // A friendly database_name in config cannot establish the actual UUID's identity.
  // Verify the physical resources using read-only requests before any remote write.
  if (remote) runner(process.execPath, [path.join(ROOT, 'scripts/cloudflare-check-account.mjs'), '--config', configuration], execution);
  for (const asset of uploads) runner(executable, ['r2', 'object', 'put', `${TARGET.bucket}/${asset.key}`, '--file', asset.file, '--content-type', asset.mime, mode, '--config', configuration], execution);
  runner(executable, ['d1', 'execute', 'DB', '--file', sql, mode, '--config', configuration, '--yes'], execution);
}

function main(args) {
  if (args.includes('--help') || args.length === 0) {
    console.log('Usage: node scripts/import-content.mjs --bundle DIR [--out .local/import/catalog] [--local | --remote] [--config FILE]\nWithout --local/--remote, validates and prepares files only. Remote operations target separate development resources only.');
    return;
  }
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (['--local', '--remote'].includes(arg)) { options[arg.slice(2)] = true; continue; }
    if (!['--bundle', '--out', '--config'].includes(arg) || !args[index + 1] || args[index + 1].startsWith('--')) fail(`Unknown or incomplete option ${arg}. See --help.`);
    options[arg.slice(2)] = args[++index];
  }
  if (!options.bundle || (options.local && options.remote)) fail('Provide --bundle DIR and choose at most one of --local/--remote.');
  const plan = prepareContent(options.bundle, options.out ?? path.join(ROOT, '.local/import/catalog'));
  console.log(`Prepared ${plan.manifest.blueprintCount} blueprint(s) and ${plan.manifest.assets.length} file upload(s) in ${plan.output}.`);
  if (options.local || options.remote) {
    applyContent(plan, { remote: !!options.remote, config: options.config });
    console.log(`Imported blueprint content into the ${options.remote ? 'separate remote development' : 'local'} database and bucket. No other tables were touched.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(`Content import stopped: ${error.message}`); process.exitCode = 1; }
}
