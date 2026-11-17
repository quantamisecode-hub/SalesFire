# Self-Hosted SMTP Guide

Operating SalesFire with your own mail server.

## Recommended: Postfix

SalesFire is an SMTP **client**. Any standards-compliant server works; Postfix
is the reference setup.

### Minimal Postfix (submission) config

```
# /etc/postfix/main.cf
myhostname        = mail.yourdomain.com
mydestination     = localhost
smtpd_tls_security_level = may        # STARTTLS on 587
smtpd_tls_cert_file     = /etc/letsencrypt/live/mail.yourdomain.com/fullchain.pem
smtpd_tls_key_file      = /etc/letsencrypt/live/mail.yourdomain.com/privkey.pem
smtpd_sasl_type         = dovecot
smtpd_sasl_path         = private/auth
smtpd_sasl_auth_enable  = yes
smtpd_recipient_restrictions =
    permit_sasl_authenticated,
    defer_unauth_destination
message_size_limit      = 10485760
```

Enable submission (port 587) in `/etc/postfix/master.cf`:

```
submission inet n       -       y       -       -       smtpd
  -o syslog_name=postfix/submission
  -o smtpd_tls_security_level=encrypt
  -o smtpd_sasl_auth_enable=yes
```

### SalesFire account settings

| Field | Example |
| --- | --- |
| Account name | Postfix Main |
| SMTP host | mail.yourdomain.com |
| SMTP port | 587 |
| Security | STARTTLS |
| Username | sales@yourdomain.com |
| Password | (stored AES-256-GCM encrypted; never displayed) |
| From email | sales@yourdomain.com |
| From name | Sales Team |

Use **587 + STARTTLS** (or **465 + SSL/TLS**) — never port 25 without TLS.

### Deliverability checklist

1. **SPF** DNS TXT record including your server IP.
2. **DKIM** signing (OpenDKIM) with a published selector/TXT record.
3. **DMARC** policy record aligned with SPF/DKIM.
4. **rDNS/PTR** matching `mail.yourdomain.com`.
5. Warm up sending volume gradually; honor the per-account daily/hourly limits.
6. Monitor bounces — hard bounces auto-suppress addresses in SalesFire.

### Testing

1. Create the account in **Settings → Email Sending**.
2. **Test Connection** — must report "SMTP connection successful."
3. **Send Test Email** to a mailbox you control; confirm headers include
   `List-Unsubscribe` and the unsubscribe footer link.
4. Click the unsubscribe link once; verify the recipient becomes suppressed and
   queued jobs for them are cancelled.

### Firewall notes

The Node.js server needs outbound TCP 587/465 to the mail server only. No
inbound mail ports are required — the app never receives mail; bounces are
detected synchronously (recipient rejection) and via classified send failures.
