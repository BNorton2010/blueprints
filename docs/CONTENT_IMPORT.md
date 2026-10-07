# Copy blueprint content into the independent library

The supplied source ZIP does **not** include the live catalog, display images, original PDFs/images, or teaching transcripts. The real catalog remains missing until you provide a content export and its associated files. Source code and fonts are available; they are not a catalog backup.

The importer accepts blueprint records and their teaching transcripts, display images, and original documents only. It rejects unexpected fields, database dumps, SQL inputs, users, conversations, quotas, settings, encrypted credentials, and strategist account records. It never downloads URLs or reads the old database.

## Obtain the content without changing the live app

1. Sign in to the **existing** app's Admin page and choose **Export blueprints**. This is a read-only export. Save the downloaded file as `blueprints.json`.
2. Download each blueprint's display image and original document. The export contains `/api/blueprints/<id>/image` and `/api/blueprints/<id>/source` references, not file bytes. Download those files in your existing signed-in browser, keeping access to draft assets restricted. The original document is available through **Open original blueprint**. Do not export any other database tables or private account data.
3. Place the files in a content bundle and add `assets.json` with the matching local filenames. Keep the original blueprint UUIDs. Send this content-only bundle if you want assistance preparing it.

An incomplete bundle stops during validation and identifies the missing image or original. The importer does not substitute content reconstructed from the public website. If a teaching transcript or full extracted framework is missing from an export, recover the original source material rather than inventing it.

## Bundle format

```text
my-blueprints/
  blueprints.json
  assets.json
  files/
    buying-beliefs.png
    buying-beliefs.pdf
```

`blueprints.json` uses the existing Admin export shape:

```json
{
  "items": [
    {
      "id": "12345678-abcd-abcd-abcd-123456789abc",
      "title": "Your actual blueprint title",
      "summary": "Your original summary.",
      "points": ["Your original key point."],
      "application": ["Your original application step."],
      "content": "The complete extracted framework.",
      "transcript": "The blueprint teaching transcript, if available.",
      "status": "published",
      "image": "/api/blueprints/12345678-abcd-abcd-abcd-123456789abc/image",
      "source": "/api/blueprints/12345678-abcd-abcd-abcd-123456789abc/source",
      "sourceName": "buying-beliefs.pdf",
      "sourceMime": "application/pdf",
      "revision": 3,
      "updatedAt": "2026-01-01T12:00:00.000Z"
    }
  ]
}
```

`assets.json` provides local files, keyed by the same UUID:

```json
{
  "version": 1,
  "assets": {
    "12345678-abcd-abcd-abcd-123456789abc": {
      "image": "files/buying-beliefs.png",
      "source": "files/buying-beliefs.pdf"
    }
  }
}
```

A blueprint without an image/original omits those paths and uses `null` or omitted `image`/`source` fields. A genuinely text-only catalog may omit `assets.json`. Asset paths must stay inside the bundle; absolute paths, URLs, parent traversal, and symlinks escaping the bundle are rejected. A display image must be PNG, JPEG, or WebP; an original may also be PDF. Each file has the existing 6 MiB limit, checked against its bytes and file signature. There are at most eight bullets per list, 200 characters in a title, 3,000 in a summary, 60,000 in extracted content, and 120,000 in a teaching transcript. Published source/transcript records require extracted framework content and a summary.

Only these optional export metadata fields are accepted: `image`, `source`, `sourceName`, `sourceMime`, `revision`, `updatedAt`. Existing revision numbers are validated but new records begin at revision 1. An export timestamp is retained as the initial record timestamp where supplied. Repeated imports preserve existing timestamps and revisions when content is unchanged.

## Validate and prepare

From the repository directory, after `npm ci`:

```sh
node scripts/import-content.mjs --bundle /path/to/my-blueprints
```

This validates the entire bundle before creating ignored `.local/import/catalog/blueprints.sql`, `manifest.json`, and staged asset copies. It reports record/file counts and performs no Cloudflare operation. Use `--out .local/import/another-catalog` to prepare a different bundle. The importer preserves edited preparation files by refusing to overwrite them; choose a new output directory when that happens.

Wrangler SQL imports have a 100 KB statement limit. The tool reserves room for SQL syntax and explicitly rejects any record producing more than 95 KB of UTF-8 SQL. That can affect a very long teaching transcript even within the app's field limits. For those records, use the new app's Admin editor with the original document and transcript; its bound database parameters support the existing field limits. A rejected bundle has no partially imported database records.

The sample at `examples/content-bundle/` is clearly labeled **synthetic preview content**. It is not the real blueprint catalog. It is not imported during installation, migration, or deployment.

## Import into the local preview

Apply the existing migrations first, then import the validated content:

```sh
npm run db:migrate:local
node scripts/import-content.mjs --bundle /path/to/my-blueprints --local
npm run dev
```

This uses the default local Wrangler state shared by `npm run dev`. To explicitly preview the synthetic example:

```sh
node scripts/import-content.mjs --bundle examples/content-bundle --out .local/import/synthetic-preview --local
```

## Import into the separate Cloudflare development app

Create the fresh `blueprints-library-dev` D1 database and `blueprints-library-dev-files` R2 bucket, apply the schema migrations, and generate ignored `wrangler.dev.json` using the deployment setup instructions. Only after access is configured:

```sh
node scripts/import-content.mjs --bundle /path/to/my-blueprints --remote --config wrangler.dev.json
```

The tool checks the exact separate development Worker, D1, and R2 names, and requires a real development database ID. Before any remote upload or SQL command, a read-only Cloudflare API check verifies that the actual database UUID belongs to `blueprints-library-dev` in the configured account, the bucket exists, and the account's separate Worker address matches. This needs `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `APP_ORIGIN` from the deployment setup; never put secret values in the bundle. Routes, environment overrides, and differing account overrides are rejected. A failed check stops all remote writes.

It uploads files before writing database records, so rows do not point at files not yet uploaded. Existing users, chats, allowances, credentials, and other database tables are never touched. It does not deploy code or alter DNS/the live Sites app.

Files use stable SHA-256 content keys. Retrying the same bundle reuses those keys and upserts the same UUIDs without changing revisions. Changed blueprint content increments its revision. No blueprint or file absent from a later bundle is automatically deleted; previously uploaded files are retained. If uploads succeed but SQL fails, retry after resolving the reported failure: uploaded files are harmless content copies, and the upserts are repeatable. This is an additive import and is not a replacement for reviewing changed content before applying it.

## Checks

```sh
node tests/import.test.mjs
```

The tests exercise real SQLite upserts, quote escaping, preservation of private tables, repeat imports, missing files, unsupported bytes/sizes, path/symlink containment, resource guards, and staged-file integrity checks. Remote commands are simulated in tests; this does not establish Cloudflare access or prove a live catalog has been imported.
