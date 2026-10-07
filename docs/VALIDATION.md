# Current implementation and validation

The independent port is implemented. The existing ChatGPT Sites app and its public domain have not been modified, redeployed, or reconfigured.

## Verified in this cloud instance

- Clean frozen-lockfile installation (`npm ci`), repeated build, and repeatable application of all three existing schema-only migrations to local D1.
- 55 automated checks passed, with no skipped, cancelled, or failed tests. They include real cryptographic JWT verification, server-side ownership/admin checks, spoofed Sites header rejection, concurrent 100-reply enforcement, AI failure recovery, voice retry, import safety, and retained UI flows.
- Cloudflare deployment dry-run passed. The Worker is approximately 75 KiB before compression; 14 static assets are separate from the Worker bundle.
- Actual local workerd requests served the app/fonts/PDF module, sign-in page, and migrated D1 catalog. Anonymous chat and forged admin access were denied.
- A clearly synthetic content bundle was imported repeatedly. Local R2 upload and image/original retrieval returned the exact uploaded file bytes through the Worker. The synthetic catalog record and uploaded object were removed afterward; the final local catalog is empty.
- Runtime dependency audit reported no known vulnerabilities. Four moderate development-tool findings remain in the inherited Drizzle Kit/esbuild loader dependency chain; that loader's development server is not used by this app. Applied migrations and the database schema remain unchanged.
- GitHub workflow YAML parsed successfully. Cloudflare deployment is manual and constrained to separate development resources with no custom-domain routes. Physical resource and live model checks precede remote mutations.
- Reusable cloud `install_script`, `start_skill`, and API network-domain additions were saved as a configuration draft. Saving does not publish a snapshot, apply runtime networking, or deploy the app.

## Awaiting configuration or supplied material

- New Clerk application settings and owner user ID. Cryptographic fixtures/UI mocks do not establish real browser sign-in or CSP compatibility with the owner's application.
- Cloudflare account access, a new D1 database, a new R2 bucket, and the development GitHub environment settings. No remote resources have been provisioned or deployed by this task.
- A fresh OpenAI project key, billing, and selected model access. Source model `gpt-6-luna` is unverified in the owner's project. Deployment runs one small live structured response check; actual recorded-audio transcription still requires a browser test.
- The real blueprint catalog, display images, original PDFs/images, and teaching transcripts. The source archive contains none of these; only source code/fonts have been copied. No existing users, chats, quotas, account records, or encrypted credentials were copied.
- Real-browser microphone permissions and PDF rendering, GitHub Actions execution, a published environment snapshot, and validation in a new restored cloud task have not been verified.

Use [deployment instructions](DEPLOYMENT.md) for account settings and [content import instructions](CONTENT_IMPORT.md) for the read-only content export. Never supply secret values in chat.
