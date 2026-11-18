# Multi Sending Accounts, Pools & Rotation — Architecture

Prompt 9.1. Extends the Prompt 6 campaign engine with multiple SMTP accounts
per campaign, a distribution-weighted pool, recipient-level assignment,
rotation, and atomic quota enforcement.

## Data model

```
Organization
 ├─ SmtpAccount (org-level, encrypted credentials, per-day limits, schedule, timezone, health, warm-up)
 │
CampaignSendingAccount   ← pool membership (campaign_id, smtp_account_id, weight, enabled)
 │                          unique per (campaign, account); drops legacy plaintext stub (004)
 ├─ Campaign
 │    account_distribution  round_robin | weighted | availability_based
 │    account_stickiness    rotate | sticky     (§78)
 │    fallback_policy       reassign | pause     (§79)
 │
CampaignLead             ← recipient-level assignment (§23)
 │    sending_account_id, assignment_method, assigned_at
 │
EmailJob                 ← send queue (Prompt 6)
 │    sending_account_id, idempotency_key (unique: org:campaign:recipient:step)
 │
EmailEvent                ← append-only log
 │    sending_account_id, sequence_step_id, variant_id
 │
SendingAccountUsage       ← atomic quota reservation; rows keyed per
 │    (smtp_account_id, period_type['day'|'hour'], period_key) — used to reserve
 │    capacity. Never an application counter.
 │
AuditLog                  ← privileged-action trail (§68)
```

## Send path

```
Worker tick
  ├─ claim job (guarded UPDATE — exactly one winner, unchanged)
  ├─ re-check campaign status (paused campaigns stay queued)
  ├─ suppression re-check
  ├─ campaign schedule (days/window, campaign timezone)
  ├─ SendingAccountAllocator.reserve()
  │    ├─ pool rows joined to SMTP accounts, org-scoped twice (IDOR safe)
  │    ├─ filter: isEnabled, status != 'error' blocks? (status='error' allowed to be retried? NO —
  │    │          policy: status='error' blocks until the connection test passes again), health != critical,
  │    │          account schedule (IANA timezone, per-day enabled/HH:MM window)
  │    ├─ filter: reserved day/hour usage + 1 ≤ effective limits
  │    │          effectiveDay  = min(account.dailyLimit, campaign.maxEmailsPerDay)
  │    │          effectiveHour = min(account.hourlyLimit, campaign.hourlyLimit)
  │    │          account-global limits stay authoritative across campaigns (§38/39/59)
  │    ├─ strategy pick (see below), then atomic reserve:
  │    │    INSERT OR IGNORE row + conditional UPDATE ... WHERE used < limit
  │    │    exactly one concurrent worker wins per unit of day+hour capacity
  │    ├─ sticky (if sticky + assigned account eligible → reuse it)
  │    └─ fallback policy when assigned account is unavailable (§32/79):
  │         reassign → fall through to pool selection; pause → hold recipient
  ├─ render (account vars resolved against the ACTUAL account at send time)
  ├─ SMTP send via nodemailer
  └─ record event + lastSentAt + usage bookkeeping
```

## Distribution strategies

- **round_robin** — fewest sends today first, then least-recently-sent. Spreads load evenly.
- **weighted** — minimise `(reserved today + 1) / weight`. Converges to the configured
  distribution subject to remaining quota and availability; never naive random.
  Weighted pools must total exactly 100% — enforced at launch and in the Sending
  Accounts UI.
- **availability_based** — pick the account with the largest remaining quota ratio; always
  adheres to limits for under-utilised accounts.

## Quotas (§26, §27, §37-39)

Quota lives in `sending_account_usage`, one row per account per day and per hour:

```
UPDATE sending_account_usage
   SET used = used + 1
 WHERE smtp_account_id = ? AND period_type = ? AND period_key = ? AND used < ?
```

Concurrent workers race on the conditional UPDATE; exactly one wins per unit of
capacity. A failed send releases the reservation (releaseUsage) so capacity is
never leaked by retries. Account-global limits stay authoritative across all
campaigns the account is pooled into.

## Assignment (§23, §24, §57, §78, §79)

Per-recipient, at send time (not launch). Assignment method recorded on the
recipient: `round_robin | weighted | availability_based | sticky | manual`.

- **Sticky** campaign setting (`accountStickiness = sticky`): every email in a
  recipient's sequence uses their assigned account. On unavailability:
  - `reassign` (default) → re-allocated to another eligible pooled account,
  - `pause` → job requeued, recipient held until the assigned account returns.
- **Rotate** (default): account can vary per email.

## Security

- SMTP passwords are AES-256-GCM encrypted at rest (`services/crypto.js`), never
  returned to the frontend (`hasPassword: true` only), never logged.
- All org scoping comes from verified JWTs. The pool join re-checks the account's
  org (defense in depth) — assigning another tenant's account to your campaign
  returns a 404, indistinguishable from "not found".
- RBAC: OWNER/ADMIN for create/edit/delete/test/pause/resume; VIEWER is read-only
  (members can view but not manage).
- Deleting a pool account with scheduled recipients requires an explicit removal
  policy: `reassign` (clear assignment → reallocate at send time), `keep`
  (keep assignments until completion) or `cancel` (cancel the queued jobs and
  mark recipients cancelled).
- Audit log records privileged actions with secret-scrubbing (`audit` in
  `services/audit.js`).

## Campaign Review & Launch

Review shows the account list with per-account weights, aggregate capacity
(remaining vs configured), and an estimated duration for the eligible audience.
Launch validates backend-side and refuses to proceed when the pool is empty, an
account is disabled/errored, credentials are missing, or a weighted distribution
doesn't total 100%.

## Known limits / honest caveats

- **Warm-up** is built as a real scheduling ramp but its health/metrics derive
  only from real sends; a warm-up engine that *simulates* inbox activity does
  not exist and is not faked.
- **Live SMTP delivery was not E2E-tested** — dev/test SMTP credentials are not
  available. Connection testing against unreachable/fake hosts is exercised and
  correctly reports failure; a green "Connection successful" requires a real
  reachable server and remains for the operator to run once credentials exist.
- The dev SQLite database is created via `sequelize.sync()`; production MySQL 8
  runs `migrations/002+*.sql` (additive; no data loss; legacy plaintext table
  `campaign_sending_accounts` is dropped by 004 after being unused in the send path).
- Distribution percentages are a *target*, not a hard guarantee: availability
  and limits can skew real allocation.
