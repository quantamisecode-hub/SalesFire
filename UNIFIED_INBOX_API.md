# Unified Inbox — API Reference

Base: `/api/v1`. Auth: HttpOnly `access_token` cookie (same as the rest of the API).
Every endpoint is org-scoped — `organization_id` is taken from the token, never from
the client. Mutations require write roles (OWNER/ADMIN/MEMBER/EDITOR/MANAGER);
VIEWER is read-only. All responses use the envelope `{ success, data }` or `{ error }`.

## Conversations

### `GET /conversations`
Query: `filter` (all|unread|mine|assigned|starred|needs_reply|replied|closed|archived|snoozed),
`search` (sender/subject/email/company/campaign/account), `sort` (last_message_at|oldest),
`campaignId`, `sendingAccountId`, `assignedUserId`, `tag`, `page` (default 1), `pageSize` (default 25, max 100).

List items contain: id, subject, status, unread (live COUNT), isStarred, isArchived,
snoozedUntil, threadStatus, tags, assigneeId/Name, accountEmail, campaignId/Name,
lead {id, firstName, lastName, companyName, email, jobTitle, status, emailStatus, leadScore},
snippet, lastMessageAt/lastInboundAt/lastOutboundAt.

### `GET /conversations/unread-count`
`{ data: { unread: <number> } }` — distinct conversations with ≥1 unread inbound message.

### `GET /conversations/:id`
Full thread: messages (chronological), lead, campaign, sending account, assignee,
insights (AI rows), live unread count. BOLA-safe: cross-org → 404.

### `PATCH /conversations/:id`
Body (any subset): `status` (open|needs_reply|waiting_for_reply|closed|archived|snoozed),
`assignedUserId` (string | null), `isStarred`, `isArchived`, `snoozedUntil` (ISO future date | null),
`tags` (string[] ≤ 20, ≤ 60 chars each). Validates status enum, assignee is an active member of the org.

### Verb shortcuts
`POST /:id/read` · `POST /:id/unread` · `POST /:id/star` · `POST /:id/archive` · `POST /:id/unarchive`
· `POST /:id/snooze {until}` · `POST /read-all` · `POST /:id/assign {userId|null}` · `POST /:id/tags {tags}`

### Messages & drafts
`POST /:id/reply { subject?, bodyText?, bodyHtml?, toEmails?, ccEmails?, bccEmails?, sendingAccountId?, signatureId?, useDraft? }`
Send pipeline: auth → RBAC → conversation org check → account validation (enabled, org-scoped) →
suppression guard → atomic quota reservation → render (variables + spintax + signature via shared pipeline) →
SMTP send → persist → audit. Returns 201-shaped `{ data: { messageId, providerMessageId, conversationId } }`.
Failure modes: 409 `suppressed|account_unavailable`, 429 `quota_exceeded`, 502 `smtp_failed`, 409 `already_sent`
(idempotent double-submit protection via content/draft-revision key).

`GET|PUT|DELETE /:id/draft` — one draft per user per conversation (upsert; never duplicated).

### AI (rate-limited 10/min/user)
`POST /:id/ai/reply { mode, instruction? }` → `{ data: { draft } }` — modes: draft|improve|shorter|professional|conversational|followup.
`POST /:id/ai/summary` → `{ data: { summary, buyingSignals[], objections[], suggestedNextStep } }`
(also persists insights rows attributed to the model; never overwrites canonical lead fields).

### Sync
`GET /email-sync/status` → per-account `{ accountId, name, fromEmail, smtpEnabled, imapConfigured, status, lastSyncAt, lastSuccessfulSyncAt, consecutiveFailures, errorCode, errorMessage }`.
`POST /email-sync/:accountId` → trigger an incremental IMAP sync now.

### Notifications
`GET /notifications?unread=1|0&page&pageSize` · `GET /notifications/unread-count` ·
`POST /notifications/:id/read` · `POST /notifications/read-all`.
Users only ever see their own notifications.

## Errors
All errors: `{ error: "<message>" }` with an appropriate status. No internal stack traces,
no secrets, no SMTP/IMAP credentials.
