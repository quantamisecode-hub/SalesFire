# Unified Inbox — Security

## Threat model
Inbound email is **untrusted input**. Every inbound byte is parsed, sanitized and
rendered with the same posture as user content, never as instructions.

| Vector | Control |
|---|---|
| Tenant isolation (IDOR/BOLA) | All queries carry `organization_id` from the verified token. Cross-org access to conversation/messages/drafts/assign/reply → **404**. Tests cover list, get, patch, assign, reply, notifications. |
| XSS via inbound HTML | `sanitizeHtml` at ingest (scripts/handlers/js-URLs stripped) + `lightClean` at render; messages are rendered inside a plain `<div>`, never executed. |
| Stored HTML payload | Same path as outbound body: sanitized before persistence. |
| Header / CRLF injection | From/To/Subject sanitized; nodemailer given pre-validated fields only; `X-SalesFire-Conversation` header added by server, never by client. |
| Prompt injection | System prompt marks email content as untrusted **data**; output rejected if it looks like SQL/shell/config (`/^(select |insert |...)/i`); AI never auto-sends and output is never used for control flow. |
| Credential theft | IMAP password stored AES-256-GCM under `imap_password_encrypted` (same key as SMTP); never returned by any API; sync status exposes only `imapConfigured: boolean`. |
| Password in logs | Audit logger strips `pass|secret|token|api_key|credential` keys; sync state stores sanitized error text (CR/LF stripped, ≤450 chars). |
| Unbounded sync | Per-account IMAP connection with 15s connect/greeting timeouts, 30s socket timeout, max 200 messages per tick, UID cursor incremental fetch (no full rescan), UIDVALIDITY reset guard, dedup via `(org, message_id)` unique index. |
| Unbounded AI spend | AI endpoints: 10 requests/min per user via `express-rate-limit`. |
| SSRF | No server-side fetching of URLs found in email content. External images are never proxied. |
| Malicious attachments | Attachments are **not stored or served** in this phase (metadata only). Download is intentionally absent rather than unsafe. |
| DoS via giant MIME | `simpleParser`/`ImapFlow` with timeouts; text/html bodies capped at 200 KB before persistence. |
| Replay / double-send | Outbound idempotency key (`reply:<conversation>:<actor>:<draftRevision|contentHash>`) + unique index; unique violation → `409 already_sent`. |
| Suppression bypass | `Suppression` checked in the send path; `reply` fails 409 `suppressed` with the stored reason. |
| Untrusted `unibox` fan-out | org-scoped `inbox:message` socket events carry ids only, not bodies. |

## RBAC matrix (conversation mutations)

| Action | OWNER | ADMIN | MEMBER | EDITOR/MANAGER | VIEWER |
|---|---|---|---|---|---|
| Read / search / list | ✓ | ✓ | ✓ | ✓ | ✓ |
| Reply, draft, assign, archive, snooze, tags, star, read/unread | ✓ | ✓ | ✓ | ✓ | — |
| Mark all read | ✓ | ✓ | ✓ | ✓ | — |
| AI endpoints | ✓ | ✓ | ✓ | ✓ | — |
| Manual sync trigger | ✓ | ✓ | ✓ | ✓ | — |
| Notifications | own only | own only | own only | own only | own only |

## Answer-by-answer audit questions
- Passwords: AES-256-GCM, never logged, never serialized (`imap_password_encrypted` not in any `attributes` allowlist projection).
- Tokens: HttpOnly cookies, existing auth path unchanged.
- Data exfiltration via AI: nothing sent beyond the transcript + lead fields explicitly passed; attachments never leave the process.

## Known gaps (honest)
- No attachment storage/scanning — metadata only by design.
- No web-push notifications; in-app notifications only.
- IMAP IDLE not used; 30s polling (still real connections).
- Conversation delete/purge not implemented (archive only); retention policy delegated to existing org policy.
