# Codex handoff: independent Blueprints Library

This is the existing Creator Blueprint Library source, exported for an independent deployment in the owner's GitHub and Cloudflare accounts. It is not yet adapted for standalone hosting.

## Required scope
Keep the live app at https://blueprints.paidtobringpeace.com unchanged. Create a separate version with a fresh database and fresh user accounts. Do not import old users, chats, quotas, strategist account records, or encrypted settings. Preserve the current UI and features; do not redesign during this initial port.

## Included
Frontend in web/, backend in worker/index.js, schema in db/schema.ts, schema-only migrations in drizzle/, build script, package lock, tests, fonts and font licenses.

The existing Sites project ID has been removed from .openai/hosting.json in this export only, to avoid accidentally targeting the live app. D1 binding DB and R2 binding BUCKET remain as architecture reference. This export contains no .git directory, runtime environment files, deployed database, uploads, or credentials.

## Not included
Live blueprint records, images, original PDFs, or transcripts: these live in D1/R2, not the source repository. Identify these as missing and provide an import path. Do not claim that copying this ZIP also copies the published catalog. No existing user data is required for this project.

## Adaptation work
- Configure standalone Cloudflare Workers, a new D1 database and a new R2 bucket, plus deployment automation.
- Replace ChatGPT Sites sign-in/sign-out routes and oai-authenticated-user-* identity headers with independently verified sessions. Never trust those incoming headers on the public Worker.
- Preserve server-side admin authorization, conversation ownership and the 100-successful-reply account allowance, plus abuse protections and concurrency controls.
- Reconnect OpenAI via a new server-side secret. The source supports OPENAI_API_KEY; do not import the old encrypted settings. CREDENTIAL_ENCRYPTION_KEY is required if retaining encrypted key storage in Admin; use a fresh key.
- Inspect the current model setting and validate availability in the owner's API project rather than assuming model access.
- Audit every remaining Sites dependency and the build/hosting manifest.
- Use a separate development URL. Do not change DNS or deploy over the old app.

README.md is the existing project documentation and includes historical descriptions; current source is authoritative. Tests currently reflect the Sites implementation and should be updated for independent authentication.

Start with source inspection, install from the lockfile, implement standalone configuration and authentication, preview, and run meaningful checks. Guide the owner through missing service access with brief instructions, without putting secret values in source or chat.

Source commit: 3803337768371e0a42e4f32cf4e7086d66336346
