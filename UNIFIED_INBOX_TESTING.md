# Unified Inbox — Testing

## Suites

### Backend `node --test test/` (isolated SQLite DBs per file, `process.exit(0)` in `after()`)
- `test/inbox.test.js` (**17 tests**) — threading, idempotent ingest, classification
  (HUMAN_REPLY / OUT_OF_OFFICE / BOUNCE DSN with real Final-Recipient / unsubscribe),
  campaign stop on reply (idempotent), notifications, tenancy, unread/read flows,
  assign RBAC, draft upsert, PATCH validation, **reply pipeline** (SMTP failure →
  FAILED + quota released; stubbed SMTP success → signature rendered), prompt-injection
  guard, AI reply/summary with stubbed provider, sync error/auth_failed persistence.
- Injectable `fetchMessages` → deterministic "IMAP" fixtures; no network needed.
- `services/email.js#sendEmail` stubbed by mutating the shared module object — the
  same seam the warmup worker uses; never reaches the network in tests.
- `services/ai.js#callKimi` stubbed likewise (tests never call the real Kimi API).

### Frontend `npm test` (vitest + Testing Library)
- Existing 34 tests still green; inbox UI primitives exercise the same service seams
  (`InboxList`, thread rendering, draft autosave logic) as the surrounding codebase.

### Static
- `npm run typecheck` (tsc --noEmit) — clean.
- Production build — clean (chunk-size advisory only).

## What is NOT covered / blocked
- **No live IMAP mailbox test** — no controlled mailbox with IMAP credentials exists in
  this workspace; `syncAccount` is proven only against injected fixtures.
- **No live SMTP send** — no SMTP credentials; outbound path proven via failure case and
  stubbed success; no unsolicited mail ever sent.
- **No Playwright E2E** — not a dependency of this repo; adding a browser runner was
  out of scope for this change.
- **Load/perf testing (10k conversations / 100k+ messages)** — not run; indexes and
  query plans added, measurements pending.
- **Attachment handling** — not implemented by design; no storage layer to test yet.
