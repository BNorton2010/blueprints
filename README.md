# Creator Blueprint Library

Independent Cloudflare port of the supplied app. The original ChatGPT Sites app at `blueprints.paidtobringpeace.com` is unchanged. Deployment targets the separate `blueprints-library-dev` Worker on `workers.dev`; no custom domain or DNS changes are configured.

The existing library, blueprint editor, transcript analysis, strategist drawer, PDF covers, themes, and voice recorder are retained. Clerk replaces Sites identity. The Worker verifies signed sessions and authorizes owners by stable Clerk user IDs. Public browsing stays anonymous. Each new account receives 100 successful strategist replies across all its conversations; failures do not spend replies. Conversation ownership, edit revisions, account/chat leases, and daily abuse limits remain server-side.

## First setup

Use Node 24:

```sh
npm ci
npm run db:migrate:local
npm test
npm run dev
```

This starts a local Worker with local D1/R2 storage. It does not create remote Cloudflare resources. Without Clerk/OpenAI configuration, browsing works and protected features fail closed. Copy `.dev.vars.example` to ignored `.dev.vars` and fill the applicable values privately to connect your own services. Do not commit that file or put secret values in chat.

The exported source includes **no published catalog, uploads, original documents, or teaching transcripts**. The new database begins empty. [Content import instructions](docs/CONTENT_IMPORT.md) explain the read-only content export and associated file bundle. The synthetic example is clearly labeled and is never imported automatically. Existing users, chats, quotas, strategist accounts, settings, and old encrypted keys must not be migrated.

## Account setup and development deployment

Follow [the account and deployment guide](docs/DEPLOYMENT.md) to create a new Clerk application, a fresh D1 database/R2 bucket, and a scoped Cloudflare token. The repository contains GitHub checks and a manually triggered development deployment workflow. Remote deployment stays blocked until those account settings are supplied.

Server configuration names:

| Name | Purpose |
| --- | --- |
| `DB`, `BUCKET`, `ASSETS` | Cloudflare D1, R2, and built static assets bindings |
| `CLERK_PUBLISHABLE_KEY`, `CLERK_ISSUER` | New Clerk application's public configuration |
| `ADMIN_USER_IDS` | Explicit comma-separated owner Clerk user IDs |
| `CLERK_AUTHORIZED_PARTIES` | Additional explicitly trusted frontend origins; the request origin is also checked |
| `CLERK_JWT_KEY` | Optional Clerk public PEM verification key; default verification uses issuer JWKS |
| `CLERK_AUDIENCE` | Optional audience claim requirement, if configured in Clerk |
| `OPENAI_API_KEY` | Fresh server-side OpenAI secret; takes precedence over encrypted Admin storage |
| `OPENAI_MODEL` | Explicit Responses model available in your own project |
| `OPENAI_TRANSCRIPTION_MODEL` | Defaults to `gpt-4o-mini-transcribe` |
| `CREDENTIAL_ENCRYPTION_KEY` | Fresh base64-encoded 32-byte AES key for retained Admin key-storage feature |

No Clerk secret key is needed for public-key session verification. New Clerk sessions have fresh account identities; JWTs are verified on each protected request, with Clerk's short token expiry bounding session revocation delay. Client-provided Sites identity headers grant no access.

The source model was `gpt-6-luna`. It remains the configuration default for fidelity, but access in your OpenAI project has **not** been assumed. With a fresh key and chosen model supplied securely, `npm run ai:check` makes one small billable structured-response request and checks model access. It does not test actual recorded-audio transcription. The Admin connection check verifies selected model access before accepting a key; an environment-managed key is read-only in Admin.

## Validation

```sh
npm test
npm run build
npm run cloudflare:check
npm run smoke
```

Run `smoke` after starting the local server. Tests cover independent cryptographic sessions, spoofed headers, ownership, private drafts, concurrent 100-reply enforcement, AI error recovery, voice retry, content-only imports, and existing UI behavior. AI calls are mocked in automated tests. Actual Clerk browser sign-in, real OpenAI generation, microphone permissions, PDF rendering on a device, GitHub Actions execution, and remote Cloudflare deployment need their respective configured services/browser.

Applied schema-only migrations under `drizzle/` remain unchanged. Run `npm run db:generate` only during an intentional schema change. Build output and local storage are ignored. Future cloud tasks should use the existing checkout; each task is isolated, so a Git worktree is unnecessary unless explicitly requested.
