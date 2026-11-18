# Unified Inbox Architecture (SalesFire)

Status: **implemented** (see UNIFIED_INBOX_QA_REPORT.md for verified status per claim).

## 1. Design principles

- **Conversation is the top-level tenant entity.** A conversation is NOT owned by a
  campaign. Campaign attribution is nullable context (`campaign_id`, `sequence_id`,
  `sequence_step_id`) established only by message-thread evidence.
- **Reply handling never guesses.** Campaign stopping, unsubscribe propagation and
  bounce handling use deterministic signals. AI may *assist* classification display
  but never flips campaign state.
- **No fake anything.** Every inbox value comes from `email_messages` rows produced
  by the real IMAP sync worker or the send pipeline. Unavailable mailboxes show
  "sync not configured", never a fabricated state.
- **Reuse, don't duplicate.** Sending reuses the SMTP service (`services/email.js`),
  quotas reuse `SendingAccountAllocator.reserveUsage/releaseUsage`, signatures reuse
  the Prompt 9 signature-resolver, threading reuses nothing because none existed —
  it is built once here.

## 2. Shape

```
Organization
  └─ SmtpAccount (SMTP credentials, AES-256-GCM)
       └─ MailboxSyncState (per-account sync cursor)
            └─ InboundEmailSyncService  (IMAP, real connection)
                 └─ EmailMessage  ── matches ──►  Conversation
                                                        │  references Lead
                                                        │  optional: campaign / sequence / step
                                                        └─ unread via COUNT(messages.is_read=false)
Unified Inbox UI  ←→  /api/v1/conversations  ←→  services/*
```

## 3. Models (all `underscored: true`, org-scoped)

| Table | Notes |
|---|---|
| `conversations` | `id, organization_id`, `subject`, `status` (open/needs_reply/waiting_for_reply/closed/archived/snoozed), `lead_id` (nullable), `campaign_id`, `sequence_id`, `sequence_step_id`, `sending_account_id`, `assigned_user_id`, `last_message_at/inbound/outbound`, `is_starred`, `is_archived`, `snoozed_until`, `tags` (JSON), `thread_status` (matched/new/needs_review), `created_at/updated_at`. Indexes: org, org+status, org+assigned_user_id, org+last_message_at, org+campaign_id, org+lead_id, org+sending_account_id, org+is_archived, org+snoozed_until. |
| `email_messages` | `id, organization_id, conversation_id`, `message_id`, `in_reply_to`, `references` (JSON), `direction` (inbound/outbound), `from_email/from_name`, `to_emails/cc_emails/bcc_emails` (JSON), `subject`, `text_body`, `html_body`, `snippet`, `headers` (JSON), `sent_at/received_at`, `status` (received/sent/failed), `is_read`, `message_type` (HUMAN_REPLY/AUTO_REPLY/BOUNCE/OUT_OF_OFFICE/SYSTEM_MESSAGE/UNKNOWN), `provider_message_id`, `mailbox_uid`, `campaign_id/sequence_id/sequence_step_id/sending_account_id/lead_id`, `idempotency_key`, `created_at/updated_at`. **UNIQUE (organization_id, message_id)** — dedupe anchor. |
| `mailbox_sync_states` | `id, organization_id, sending_account_id` (UNIQUE per account), `provider` (`imap`), `last_uid`, `last_sync_at`, `last_successful_sync_at`, `status` (idle/syncing/error/auth_failed/disabled), `error_code`, `error_message`, `consecutive_failures`, `created_at/updated_at`. |
| `conversation_drafts` | `id, organization_id, conversation_id, user_id` (UNIQUE per user+conversation), `to_emails/cc_emails/bcc_emails` (JSON), `subject`, `text_body`, `html_body`, `sending_account_id`, `signature_id`, `created_at/updated_at`. |
| `conversation_insights` | `id, organization_id, conversation_id, type` (summary/buying_signal/objection/intent), `value`, `confidence`, `source_message_id`, `model`, `created_at`. AI-attributable, never merged into lead/company. |
| `notifications` | `id, organization_id, user_id`, `type`, `title`, `body`, `conversation_id` (nullable), `is_read`, `created_at/updated_at`. |

Deviation from suggested models: no `contact_id`/`company_id` — the app has one
canonical person record (`Lead`) which already carries companyName/website/industry;
a second contact table would duplicate it. `contact_id`/`company_id` resolution is:
lead → companyName fields. Conversation stays valid without any of these.

## 4. Mailbox synchronization (real, not fake)

`InboundEmailSyncService` uses **IMAP** (`imapflow` + `mailparser`).

- Each `SmtpAccount` may additionally hold IMAP settings (`imap_host`, `imap_port`,
  `imap_secure`, `imap_username`, `imap_password_encrypted` — same AES-256-GCM as SMTP).
- Sync worker (`services/inbound-email-worker.js`) polls enabled+configured accounts on
  `INBOX_SYNC_INTERVAL_MS` (default 30s) **in-process with the existing API server**
  (no new server), mirroring the campaign/warmup workers. Manual trigger:
  `POST /api/v1/email-sync/:accountId`.
- Incremental sync uses `UID > last_uid` (UIDVALIDITY guard: if the server reports a
  UIDVALIDITY change, the cursor resets and the mailbox re-syncs from scratch —
  duplicates still blocked by the message_id unique index).
- Idempotency: `(organization_id, message_id)` unique index + pre-check; unread never
  double-counts; notifications/jobs/events are created inside the same transaction as
  the message row (or not at all).
- Failure taxonomy: `auth_failed` (no retry) ≠ `temp_failure` (backoff, capped
  consecutive failures) ≠ `network` (retry next tick). Status persisted on
  `mailbox_sync_states`; surfaced in Settings → Email Sync.
- No inbox ever clears messages; attachments never stored without sanitization; HTML
  never rendered raw in the browser (server-side `sanitizeHtml` at ingest + client
  `lightClean` at render).

## 5. Threading engine (`services/conversation-threading.js`)

Ordered:
1. Parse `In-Reply-To`/`References`; normalize Message-IDs (trim, strip `<>`, lowercase).
   Match against `email_messages.message_id` of this org (any direction). High confidence.
2. Normalize subject (strip `Re:|RE:|Fwd:|FW:|([tag])` prefixes, collapse whitespace,
   lowercase) **and** match against an existing conversation for the same
   sender↔account pair on this org. **Medium confidence** — requires BOTH subject AND
   the sender/recipient pair match within the same sending account; otherwise → NEW
   conversation.
3. If only weak signals matched (e.g. references present but target unknown) → a new
   conversation flagged `thread_status = 'needs_review'` (surface in UI for human triage),
   never silently merged.

## 6. Message classification (`services/message-classifier.js`)

Deterministic first, every signal recorded in `headers` for auditability:

- `BOUNCE`: DSN (`multipart/report; report-type=delivery-status`), or from postmaster/mailer-daemon with delivery-failure phrases, or status code `5.x.x` → permanent (hard) bounce only; `4.x.x` → soft (no suppression escalation, logged).
- `OUT_OF_OFFICE`: `Auto-Submitted: auto-replied` header or OOO subject patterns — sequence NOT stopped, notification only.
- `AUTO_REPLY`: `Auto-Submitted` present (other) or `X-Auto-Response-Suppress` — same as OOO.
- `SYSTEM_MESSAGE`: mailer-daemon notices that are neither bounce nor OOO.
- `HUMAN_REPLY`/`UNKNOWN`: everything else.

Deterministic unsubscribe patterns (`unsubscribe`, `remove me`, `stop emailing`, …)
flip the suppression list + lead/recipient status using the existing suppression
architecture inside the same transaction.

## 7. Campaign attribution & stopping

On inbound message creation (in the same transaction):

- If thread matched a prior outbound `email_job` with `message_id` equal to a
  referenced message, or the conversation already carries campaign context → reuse it.
- `HUMAN_REPLY` → recipient `replied_at`, status `replied`, lead `status='replied'`,
  queued `email_jobs` for that recipient destroyed (no more sends), `EMAIL_REPLIED`
  event row appended. Transactional with message creation; idempotent (recipient already
  replied → no-op). Replica of the stop semantics documented in the campaign engine.
- `BOUNCE` (hard) → suppression `bounced` + lead `emailStatus='bounced'`.
- `unsubscribe` → suppression `unsubscribed` + recipient `unsubscribed` + lead `unsubscribed`.
- `AUTO_REPLY`/`OUT_OF_OFFICE` → no campaign state change; notification only.
- `SYSTEM_MESSAGE` → logged only.

## 8. Reply pipeline

`POST /api/v1/conversations/:id/reply`:

1. Auth + org gate; RBAC (privileged/member write).
2. Load conversation, verify org ownership (BOLA-safe 404).
3. Resolve sending account: `conversation.sending_account_id` (if enabled in org) else
   requested `sendingAccountId`; never an unrelated account silently.
4. Checks: account enabled; `reserveUsage` quota (reused) with `releaseUsage` on failure;
   suppression check on the recipient.
5. Render via `templateRenderer.renderEmail` (variables + spintax) with `buildLeadVars`;
   signature from the existing signature-resolver (conversation → campaign → account →
   org default → none); sanitize via the existing server-side sanitizer.
6. Send via `services/email.js` transport; only after SMTP 250-OK create the outbound
   `email_messages` row + update conversation timestamps. On SMTP failure the message is
   `FAILED` — never falsely SENT. Usage released on failure.
7. Audit + org-scoped socket event (`inbox:message`).

## 9. AI (Kimi, server-side only)

`services/ai.js` gains `generateReplyDraft`, `summarizeConversation`, `extractInsights`
using the existing Kimi chat abstraction. Prompts hard-label email content as
**untrusted DATA** (never instructions); the response is stripped of anything that
looks like SQL/shell/config directives; output is shown, never auto-sent; insights
stored in `conversation_insights` with model + confidence and always labelled
"AI Generated". AI endpoints are rate-limited strictly.

## 10. API surface (mounted under `/api/v1`, cookie auth + org gate)

`GET /conversations` (filters: `unread|assigned|mine|starred|needs_reply|replied|archived|snoozed|closed|all`,
`campaignId`, `sendingAccountId`, `assignedUserId`, `tag`, `search`, `sort`, `page`),
`GET /conversations/:id`, `PATCH` (assign/star/archive/snooze/status/tags),
`POST /:id/read|unread|star|archive|unarchive|snooze|assign|tags`,
`GET|POST|PUT|DELETE /:id/draft`, `POST /:id/reply`, `POST /:id/ai/reply|summary|insights`,
`POST /email-sync/:accountId`, `GET /email-sync/status`,
`GET /notifications` + `POST /notifications/:id/read|read-all`.

## 11. Failure & security notes

- SMTP succeeds but DB write fails → outbound message persisted with
  `idempotency_key = conversation:<uuid>` and the sync worker reconciles: an outbound
  message whose key exists is skipped, never resent. Documented, tested.
- Cross-tenant access → 404 everywhere (list, get, patch, draft, reply, attachment,
  assign, AI). Attachment bytes are never served inline without sanitization; downloads
  carry `Content-Disposition: attachment` + `nosniff`.
- SSRF: inbound HTML is never fetched server-side; external images render only through
  the client's standard `<img>` with no referrer leakage beyond what browsers send, and
  the app never proxies them.
- Headers/CRLF: `From`/`To`/`Subject` are sanitized (CR/LF stripped) before nodemailer.

## 12. Environment variables

- `INBOX_SYNC_INTERVAL_MS` (default 30000)
- `IMAP_MAX_CONNECTIONS` (default 3)
- `IMAP_INITIAL_FETCH_LIMIT` (default 100)
- `INBOX_POLL_TIMEOUT_MS` (default 15000)

No existing variable renamed; secrets unchanged.

## 13. Known simplifications (see QA report)

- `contact_id`/`company_id` not implemented (lead is canonical).
- Attachments: metadata stored + enforced limits; no malware scanning service (none exists in repo) — downloads always forced.
- Notifications: per-user rows; no web push.
- Sync = IMAP IDLE-free 30s polling (real connections, incremental cursors); socket.io push for UI freshness; 60s fallback poll in UI.
