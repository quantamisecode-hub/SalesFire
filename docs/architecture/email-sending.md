# Email Sending (SMTP accounts)

Managing self-hosted SMTP sending accounts in SalesFire.

## Model

SalesFire requires **no paid email provider**. Sending goes through your own
standards-compliant SMTP server (Postfix, Exim, etc.) via `nodemailer`:

```
Node.js API → EmailService → SMTPProvider (nodemailer transport) → Your SMTP server
```

The Node app never runs an SMTP server itself; it is an SMTP **client**.

## Endpoints

Under `/api/v1/email-sending` (auth + org scoped):

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/accounts` | List accounts (never returns passwords) |
| POST | `/accounts` | Create account |
| PATCH | `/accounts/:id` | Update (empty password = keep existing) |
| DELETE | `/accounts/:id` | Soft-delete |
| POST | `/accounts/:id/test` | Real SMTP connection test |
| POST | `/accounts/:id/send-test` | Send a real test email |

## Credential security (§31)

- Passwords are encrypted at rest with **AES-256-GCM** (`services/crypto.js`),
  key from `ENCRYPTION_KEY`, stored as `iv.tag.ciphertext` (base64).
- Passwords are **never** returned by any API, never logged, never placed in
  audit logs or error messages. The UI shows only "Password stored (encrypted)".
- `PATCH` with an empty password leaves the stored ciphertext untouched.

## Connection test

`POST /accounts/:id/test` performs a real `verify()` on a fresh transport:
connect → TLS → AUTH. Results are sanitized before storage/display — users see
"SMTP connection successful." or a classified message such as "SMTP
authentication failed." / "SMTP host not found." / "SMTP delivery failed." Raw
stack traces and credentials are never surfaced (§29).

## Test email

`POST /accounts/:id/send-test` validates the recipient address server-side
(422 "A valid test email address is required"), then really sends through the
configured server. Test emails **never** become campaign recipients and never
affect campaign analytics (§30).

## Limits & delays

Each account carries `daily_limit`, `hourly_limit`, `min_delay_minutes`,
`max_delay_minutes`. The campaign worker checks these before every send and
jitters `next_send_at` inside the min/max delay band to avoid bursts.
