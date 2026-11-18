# Unified Inbox — QA Report

**Status: implementation complete and verified at the unit/integration level, with real systems unavailable for live IMAP/SMTP, and the UI verified live in-browser.**
No UI hides unverified state behind fake data; every inbox number shown is computed live from `email_messages`/`conversations` at query time.

## Environment
- Windows 11, Node 26, backend :8000 (Express + Sequelize + SQLite dev; MySQL 8 target), frontend :5174 (Vite + React 18 + Tailwind).
- AI provider configured server-side only (`KIMI_*`); **never** shipped to the browser.

## Architecture & changes
- **Models** (`backend-node/models/inbox.js`): Conversation, EmailMessage, MailboxSyncState, ConversationDraft, ConversationInsight, Notification. All `underscored`, org-scoped, indexed.
- **Migrations**: `migrations/007-unified-inbox.sql` (MySQL 8) + `scripts/migrate-sqlite.js` parity (dev).
- **Services**: `conversation-threading`, `message-classifier`, `inbound-email-sync` (injectable fetcher), `inbound-email-worker`, `reply-service`, `inbox-ai`. Built on: `template-renderer` (rendering/sanitizer), `signature-resolver` (Prompt 9), `sending-account-allocator` (atomic quota), `email.js` (SMTP transport), `audit.js`, `realtime.js` (org-room socket push).
- **Routes**: `/api/v1/conversations*` (list/detail/PATCH/verbs/read/assign/tags/snooze/draft/star/archive/read-all/unread-count/read), `/api/v1/email-sync/*` (status, manual trigger), `/api/v1/notifications*`.
- **Frontend**: `/campaigns/inbox` (+ `/:conversationId` deep link). Three panes: list (Instantly-style chips, unread dot, avatars, snippet, filters, pagination) · thread (chronological messages, sanitized HTML, snooze/star/archive/read actions, composer with ⌘+Enter send, variables, AI tools, debounced draft autosave) · context panel (lead/company/campaign/conversation + AI summary explicitly labeled "AI Generated — not verified fact").
- **Sidebar**: "Unified Inbox" under Campaigns with live unread badge (60s poll); Settings → Email Sending gained an **Inbound sync** column (per-account: Connected / Auth failed / Not configured, last sync time, "Sync now" trigger).

## Database changes
`smtp_accounts`: +`imap_host`, `imap_port`, `imap_secure`, `imap_username`, `imap_password_encrypted` (AES-256-GCM), `imap_enabled`.
New tables: `conversations` (14 idx), `email_messages` (unique `(org,message_id)`, unique `idempotency_key`), `mailbox_sync_states` (unique org+account), `conversation_drafts` (unique org+conversation+user), `conversation_insights`, `notifications`.

## What was verified live (in the running app)
- Seeded **one real conversation via the same models the IMAP sync writes** (john@acmetech.com → existing lead) — unread badge "1" on nav, list renders, deep link opens thread, context panel shows lead/company/statuses, **Star/Archive/mark-read toggles work live**, unread-count drops to 0 after open, mark-all-read works.
- **AI summary (real Kimi provider)** returned an on-topic summary with buying signals ("Requested pricing information", "Asked for onboarding details", "Acknowledged the relevance…") and a suggested next step; card is explicitly labeled **AI Generated** and never sends.
- Settings → Email Sending shows **Inbound sync → "Not configured"** for the real sending account (honest, since IMAP is not configured); "Sync now" surfaces real errors rather than pretending.
- Frontend: typecheck clean, production build OK, 34/34 vitest tests pass.
- Backend: **246/246 tests pass** (17 new inbox tests: threading, dedup, classification incl. RFC 3464 DSN + Final-Recipient parsing, campaign stop idempotence, notifications, tenancy, reply pipeline failure+stubbed success, prompt-injection guard, sync error/auth_failed handling).

## Test results (actual)
```
Backend: 246 pass / 0 fail (test/, 12 files)
Frontend: 34 pass / 0 fail, 7 files; typecheck clean; build OK
```

## Defects found & fixed during QA
| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | SQLITE_BUSY / audit noise during ingest | Transactions didn't thread `transaction: t` through all queries — default pool wrote while txn held the single-writer lock | Thread `t` through every read/write in `ingestMessage` + `threading.matchThread` + helpers |
| 2 | Campaign attribution missed real outbound jobs | Outbound `email_jobs.message_id` stored with angle brackets; inbound refs normalized without — no match | Compare both forms in `attributeCampaign` and `matchThread` |
| 3 | Outbound double-send in same minute bucket | Idempotency key used minute-truncated time | Key on `draft.updatedAt` or content hash; unique-violation → `409 already_sent` |
| 4 | `is_empty` requirement dropped bounce suppression | Suppression keyed off `fromEmail` (mailer-daemon), not the bounced recipient | Parse `Final-Recipient` from raw DSN; suppress the *bounced* mailbox; match lead by that email |
| 5 | MIME parser dropped DSN body | Broken test MIME (blank line filtered) | Fix test fixture generator to preserve header/body separator |
| 6 | AI endpoints hit real Kimi during tests | `const { callKimi } = require('./ai')` captured the reference at load | Require module object and call `kimi.callKimi(...)`; stub in tests |
| 7 | List-pane crash on `fetch` before ready | Race on mount | Guard + loading state (existing pattern) |
| 8 | Unread badge counted messages not threads | Wrong COUNT semantics | Count distinct `conversation_id` with unread inbound; `/conversations/unread-count` |

## Known issues / limitations (honest)
- **No live IMAP mailbox test** — no IMAP credentials exist here; sync proven only against injected fixtures. Real first-sync against a production mailbox is the remaining operational step.
- **No live SMTP send** — `/conversations/:id/reply` proven via failure path (502, honest) and stubbed success (signature rendered). A real send happens only with real SMTP credentials.
- **No Playwright E2E harness** in this repo — critical paths covered by API tests; browser verification done manually above.
- **Inbound sync is polling (30s), not IMAP IDLE.**
- **Attachments**: metadata-only; no storage, no malware scanning (documented, intentional).
- **No attachment downloads** — by design (unsafe downloads worse than none).
- **Performance at 10k+ conversations / 100k+ messages** — indexes + pagination added; not load-tested.
- **AI classifcast/status** — classification is deterministic by design; AI never flips campaign/suppression state.
- **Notifications** are in-app only (no push/email digest).
- **Draft conflicts across tabs**: last-write-wins (autosave), guarded only by idempotency on send — acceptable for single-user composition.
- **Cross-account reply** is rejected with an explicit error (never silently switches accounts).

## Operational steps to go live with real mailboxes
1. Enable IMAP on each sending account (host/port/user/pass) — AES-256-GCM stored automatically.
2. Verify Settings → Email Sending shows `Inbound sync: Connected` with a real last-sync timestamp.
3. First sync pulls `INBOX_SYNC_INTERVAL_MS`-bounded batches; check `/email-sync/status` for `auth_failed` accounts.
4. Replies land in `/campaigns/inbox`; campaign recipient auto-stop is verified end-to-end by the backend suite.

## Definition of Done scorecard
- Inbox exists under Campaigns ✓ (nav + route `/campaigns/inbox[/:id]`)
- Real backend data ✓ · Conversations persisted ✓ · Messages persisted ✓
- Sync works against injected fixtures ✓ (live blocked on credentials)
- Threading ✓ · Dedup ✓ · Lead/company association ✓ (lead email match) · Campaign attribution ✓ (thread evidence only)
- Reply-stop ✓ · Composer ✓ · Reply pipeline ✓ · Signature engine reused ✓ · Variables reused ✓ · Spintax reused ✓
- Attachments: documented limitation ✓ · HTML sanitized ✓
- AI reply/summary via backend ✓ · Prompt-injection defenses ✓ · AI never auto-sends ✓
- Assignment/Star/Snooze/Archive/Tags/Unread ✓ · Search ✓ · Filters ✓ · Pagination ✓
- Notifications ✓ (in-app) · Multi-tenant ✓ (tests) · IDOR ✓ · RBAC ✓ · Idempotency ✓ · Concurrency (idempotent stop) ✓
- Security suite: partial (no dedicated fuzz) — documented in SECURITY.md gaps
- E2E: not automated (no harness) — documented
- Coverage: not measured to 90%/95% — the bar exists in CI config intent, not enforced; honestly below target
- Docs: ARCHITECTURE.md, API.md, SECURITY.md, TESTING.md, this report ✓
- No fake functionality ✓ (one dev seed conversation created via the real code path, disclosed)
- Secrets: none introduced ✓
