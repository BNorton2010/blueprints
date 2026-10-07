# Independent Cloudflare development deployment

This repository builds a separate `blueprints-library-dev` Worker. It uses a new D1 database and R2 bucket, and a new Clerk application. The configuration contains no custom-domain routes. The existing ChatGPT Sites app and its public domain remain unchanged.

The source ZIP does **not** include the live blueprint records, display images, original PDFs, or teaching transcripts. A fresh database therefore starts with an empty catalog. See [content import](CONTENT_IMPORT.md) for the supported content-only import; do not provide a full old database dump.

## Local development

Use Node.js 24 and the versions pinned in `package-lock.json`:

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm test
npm run cloudflare:check
npm run dev
```

`npm run dev` builds and starts the Worker with local D1, R2, and static assets. Local data is stored in ignored `.wrangler/`; migrations are repeatable. Public pages work before service credentials are added. Independent login, OpenAI replies, and transcription require the configuration below. `.dev.vars` is ignored and must never be committed.

In a cloud sandbox with a read-only home directory, set writable tooling locations before these commands:

```sh
export NPM_CONFIG_CACHE=/workspace/.npm-cache
export XDG_CONFIG_HOME=/workspace/.config
export WRANGLER_SEND_METRICS=false
```

Each Codex cloud task already has its own isolated environment. Use the existing checkout; do not create a Git worktree unless the owner explicitly requests one.

## Accounts to create

1. **Cloudflare:** use your own account, enable R2, and enable the account's `workers.dev` subdomain. Create only a new D1 database named `blueprints-library-dev` and a new R2 bucket named `blueprints-library-dev-files`. Save the new database UUID and Cloudflare account ID. Do not select existing Sites resources or edit DNS.
2. **Clerk:** create a **new** application for fresh accounts. Email verification is a practical initial sign-in method. Use its development instance during this phase. Copy the Publishable Key and Frontend API URL (the session-token issuer) from the application settings. Create your owner user in Clerk and copy its `user_…` ID from Users. Administrator access uses that exact ID, checked server-side. Other accounts receive no admin privileges.
3. **OpenAI:** create a new project API key with billing enabled. Choose a strategist model available through the Responses API and confirm access to the configured transcription model. The source setting is `gpt-6-luna`; model availability cannot be established without access to your project. `npm run ai:check` checks both model IDs and makes one small billable structured-response request after the key is configured. Actual voice transcription still needs a recorded-audio check.

Clerk manages sign-in and sessions. The Worker verifies JWT signatures, issuer, expiry, and authorized origin, then looks up the configured administrator IDs. Incoming `oai-authenticated-user-*` headers grant no access. No old users, conversations, quotas, strategist account records, or encrypted settings are imported. Each new signed-in account has 100 successful strategist replies across all its conversations.

## Configuration names

Public application settings may be placed in ignored `.dev.vars` for local use. Deployment automation reads public values from the GitHub `development` environment's **Variables**:

| Name | Value to supply |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `CLOUDFLARE_D1_DATABASE_ID` | UUID of the **new** `blueprints-library-dev` database |
| `APP_ORIGIN` | `https://blueprints-library-dev.<your-account-subdomain>.workers.dev` |
| `CLERK_PUBLISHABLE_KEY` | Publishable Key for the **new** Clerk application |
| `CLERK_ISSUER` | HTTPS Frontend API origin for that same Clerk application, without a path |
| `ADMIN_USER_IDS` | Your Clerk `user_…` ID; commas separate multiple owners |
| `OPENAI_MODEL` | Explicitly choose an available Responses API model; local source default is `gpt-6-luna` |
| `OPENAI_TRANSCRIPTION_MODEL` | An available transcription model; default `gpt-4o-mini-transcribe` |
| `CLERK_AUDIENCE` | Optional exact audience if you configured one in Clerk session tokens |

`CLERK_AUTHORIZED_PARTIES` is generated as the exact development app origin for deployment. For local development, the example includes both local origins used on port 8787. `CLERK_JWT_KEY` is an optional public PEM signing key for verification without a JWKS network request; normally leave it unset and use Clerk's rotating JWKS endpoint.

Place these values only in the GitHub `development` environment's **Secrets** or Cloudflare Worker secrets; never paste them into chat or commit them:

| Name | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | GitHub deployment access to your Cloudflare account |
| `OPENAI_API_KEY` | Server-side strategist and transcription requests |
| `CREDENTIAL_ENCRYPTION_KEY` | A fresh base64-encoded 32-byte key for the preserved Admin encrypted-key storage |

Create the encryption key on your own machine with `openssl rand -base64 32`, then enter its output securely as the secret. Use a new key; never copy encrypted credentials or the encryption key from the old app. Deployment uses `OPENAI_API_KEY` directly. The preserved Admin connection tool can securely store a replacement key in the fresh D1 database when no server-side OpenAI key is configured.

Create a Cloudflare API token scoped to your own account with **Workers Scripts: Edit**, **D1: Edit**, **Workers R2 Storage: Edit**, and **Account Settings: Read**. The read-only account check verifies the physical database name and bucket before any migration. No Zone or DNS editing permission is needed. Provision the two named resources in the Cloudflare dashboard, or use these commands after authentication is configured:

```sh
npx --no-install wrangler d1 create blueprints-library-dev
npx --no-install wrangler r2 bucket create blueprints-library-dev-files
```

If either name already exists, inspect it before proceeding; do not substitute an existing app's database or bucket.

## GitHub automation

The independent implementation is committed to this repository. The original supplied export remains recoverable in Git history. The check workflow runs on pull requests and pushes to `main`; it installs from the lockfile, runs the tests, builds, and validates the Cloudflare package without deploying. Deployment is a separate **manual** workflow and has no custom-domain step.

In your private GitHub repository:

1. Open **Settings → Environments**, create `development`, and add the Variables and Secrets listed above. Environment protection rules can restrict who may run deployment.
2. Open **Actions → Deploy separate Cloudflare development app → Run workflow**, selecting `main` after configuring the development environment. Review the implementation before enabling account access.
3. Use the separate Worker address from `APP_ORIGIN`. In Clerk, allow that address for sign-in redirects/origins where required. Sign in as your owner account, verify Admin access, import the blueprint content, then test a strategist reply and a voice recording.

The manual workflow checks the app, creates ignored `wrangler.dev.json` from the public settings, and verifies the new resources with read-only Cloudflare requests. Before changing Cloudflare, it checks both OpenAI model IDs and verifies one small billable structured strategist response. It then applies schema-only D1 migrations, installs new server-side secrets, and deploys the new Worker. Wrangler creates a new draft Worker for the secrets if it does not exist yet; the app is deployed only after the secret upload succeeds. Secrets pass through a process pipe and are not written into source or build artifacts. The final check verifies the anonymous session endpoint; actual Clerk login, a real strategist conversation, and recorded-audio transcription still need testing on the development app.

`wrangler.jsonc` intentionally contains a local-only database placeholder. Remote operations use generated `wrangler.dev.json`, and the generator rejects custom domains, other Worker names, invalid database IDs, and mismatched Clerk application settings.

For an authenticated operator running the same checks manually:

```sh
npm run cloudflare:config
npm run cloudflare:verify
npx --no-install wrangler deploy --dry-run --config wrangler.dev.json --outdir .local/deploy-check
npx --no-install wrangler d1 migrations apply DB --remote --config wrangler.dev.json
```

Use the GitHub workflow for the first deployment so both new secrets are installed before the app is deployed. Later deployments may use `npx --no-install wrangler deploy --config wrangler.dev.json` after those secrets already exist. Never deploy with legacy Sites tooling or change the existing public domain during this phase.

## Access still needed

Without the new account configuration, the code can be built and exercised against local D1/R2, including authentication tests and mocked provider responses. Actual user sign-in requires the new Clerk application; live strategist/transcription checks require OpenAI access; a reachable development URL requires Cloudflare deployment access. Published catalog content remains missing until its content-only export and associated files are supplied.
