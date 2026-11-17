# Campaign Engine

How the Prompt 6 campaign & outreach engine works end to end.

## Flow

```
Approved leads → Campaign wizard → Audience enroll → Sequence
   → (optional Kimi personalization, human-approved) → Review → Launch
   → email_jobs queue → Worker → suppression + window + limit checks
   → SMTP (nodemailer) → email_events → Analytics
```

## Campaign lifecycle

States: `draft → ready_for_review → scheduled → active → paused → completed`,
plus `cancelled`, `failed`, `archived`. Transitions are enforced server-side in
`backend-node/routes/campaigns.js` (transition map); the frontend mirrors them
but is never trusted. `running` is accepted as a legacy synonym of `active`.

- **Launch** — allowed from `draft`, `ready_for_review`, `scheduled`, `failed`.
  Re-validates: state, audience (≥1 recipient), SMTP account (enabled, creds
  present), sender identity, sequence, schedule, suppression, limits, RBAC.
  On success it queues each eligible recipient's first step and records QUEUED
  events. Returns `{ queuedJobs, suppressedRecipients }`.
- **Pause** — no new claims; queued jobs re-check campaign status at send time.
- **Resume** — recipients keep their `next_send_at`; nothing is dumped at once.
- **Cancel / Archive** — stop future sends, preserve history and analytics.
  Campaigns are never deleted.

## Queue & worker

`backend-node/services/campaign-engine.js` runs a worker (started in
`server.js`, 20-second tick, `WORKER_ID`-suffixed):

1. `claimJob()` — guarded `UPDATE email_jobs SET status='claimed',
   claimed_at=now(), claimed_by=:worker WHERE id=:id AND status='pending'`.
   Only the worker whose UPDATE matches one row proceeds → **two workers can
   never send the same job** (verified by a concurrency test).
2. Re-checks: campaign `active`, account enabled, suppression list, sending
   window (`send_days_of_week`, start/end hour), daily/hourly limits, min/max
   delay jitter.
3. Sends via the email service, records `SENT`/`FAILED`, classifies failures.
4. On success schedules the next step (`next_send_at` = now + delay ± jitter),
   records QUEUED for it.

Bounces: `permanent`/`auth`/`dns` failures suppress the address (org-wide,
reason `bounced`); transient failures retry with backoff up to `max_attempts`.
No infinite retries.

## Suppression

Checked at enroll time **and again before every send**. Sources: global
unsubscribe, org suppression list (email, reason), bounced, invalid, duplicate,
manually blocked. Suppressed recipients are skipped and marked, never sent.

## Unsubscribe

Every campaign email carries a `List-Unsubscribe` header and a footer link
`${APP_BASE_URL}/api/v1/unsubscribe/<token>`. Tokens are HMAC-SHA256 signed
(payload: org, campaign, recipient, email) — tamper-resistant. `GET` renders a
confirm page; `POST` performs: org-wide suppression (reason `unsubscribed`),
UNSUBSCRIBED event, recipient status update, and cancellation of that
recipient's queued jobs.

## AI personalization (Kimi)

Design-time only: `POST /api/v1/campaigns/:id/personalize` calls Kimi through
the backend (`services/ai.js`, OpenAI-compatible). The user compares ORIGINAL
vs AI VERSION and must Accept to persist AI text into the step body. Without
`KIMI_API_KEY` the endpoint returns **501** ("AI is not configured…") — no fake
text is ever produced. The AI is instructed to use only verified lead/contact/
company data and to never invent facts; unknown template variables are rejected
server-side. The key never reaches the browser.

## Analytics

All metrics are computed from `email_events` + `campaign_leads` — never
counters incremented in frontend code. Delivered = SENT minus synchronously
detected hard bounces (self-hosted SMTP has no separate delivery webhook).
