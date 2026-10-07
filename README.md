# Creator Blueprint Library

Standalone app extracted from ContentOS, with a public visual library, private blueprint studio, and a contextual strategist drawer.

## Owner workflow

Open `/admin` and sign in using the configured owner account. Expand **AI connection** and connect an OpenAI API key once. Keys are encrypted with AES-GCM using the production secret `CREDENTIAL_ENCRYPTION_KEY`; API responses never return the key.

Choose **Add blueprint**, upload a PDF or PNG/JPEG/WebP, and click **Generate summary**. PDF uploads generate a first-page cover locally in the browser; a custom display image can replace it. Review the summary, key points, application steps, and full extracted source content. Choose Draft or Published and save. Drafts and their files are restricted to the owner.

## Implementation

- `web/builder-chat.js` and `web/contextual-chat.css` reuse the actual ContentOS shared drawer, composer, safe Markdown rendering, keyboard handling, scroll behavior, and typing indicators.
- `web/blueprints.css` carries the existing blueprint grid/detail styles. `web/voice.js` adapts ContentOS's recording, pause/resume, transcript insertion, retained-audio retry, microphone cleanup, and recording guards to this standalone app.
- D1 owns metadata, detailed extracted blueprint context, private visitor conversations, encrypted connection settings, and bounded anonymous AI usage. R2 owns originals and images.
- The strategist selects relevant published blueprints from their compact catalog, then retrieves detailed matching source excerpts. It uses only the visitor's stated business facts. Replies include checked blueprint citations.
- Anonymous visitors receive an HttpOnly, Secure, SameSite cookie; conversation ownership is verified server-side. Owner writes check dispatch-authenticated identity and same-origin requests. Revision checks protect concurrent edits. Chat leases and request IDs protect duplicate turns.
- Public browsing and chat do not require sign-in. `/admin` initiates dispatch-owned ChatGPT sign-in and allows only `ADMIN_EMAIL`.

## Development and validation

Run `npm install`, `npm run db:generate` when schema changes, `npm test`, then `npm run build`. Generated schema-only migrations ship under `dist/.openai/drizzle`. Applied migrations must remain immutable.

The 12 behavior checks exercise owner authorization, cross-origin writes, draft exclusion, revision checks, validated uploads, editable analysis, encrypted credentials, private conversation isolation, grounded retrieval/citations, idempotent turns, failure recovery, and public/admin UI flows. AI requests are mocked in tests; real generation and transcription require the owner connection. PDF rendering and actual microphone permission need a browser for final device verification.

This app has its own database and uploads. Five published ContentOS blueprints and their original images were imported on September 30, 2026. Two placeholder configurations were replaced with summaries and context extracted from their original images. Future edits use the blueprint studio. Dark mode is the default, with an optional light theme. A dismissible fixed banner links to the custom AI tool-building service.

## Strategist allowance
Public browsing remains anonymous. Chat and transcription require dispatch-owned ChatGPT sign-in. Each stable site account receives 100 successful chat replies total with no expiry, shared across conversations and devices. Failed replies consume no allowance. A per-account lease prevents concurrent chats bypassing the limit. Existing IP daily anti-abuse limits remain in place; these are not a dollar budget. Luna defaults to low reasoning for advice and none for blueprint selection. Live AI still requires an owner-provided API key with model access.

Admin transcript input accepts pasted text or UTF-8 TXT/MD/SRT/VTT uploads (120,000 characters). Raw transcript text persists privately in D1; analysis combines it with a supplied or saved visual/PDF source. Generated detailed context, not the raw private transcript field, feeds the strategist. Transcript changes clear stale extracted context and require regeneration or manual replacement before publishing.
