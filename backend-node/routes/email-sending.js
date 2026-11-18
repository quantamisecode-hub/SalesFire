// Email-sending (SMTP) account routes — PROMPT 9.1 management center.
// Passwords: AES-256-GCM encrypted at rest, never returned to any client.
// Read routes: any org member. Mutations / SMTP tests / credential edits:
// OWNER or ADMIN only (§49). All org scoping comes from the verified token.
const express = require('express');
const models = require('../models');
const { verifyAccessToken } = require('../security');
const emailService = require('../services/email');
const { encryptSecret } = require('../services/crypto');
const realtime = require('../services/realtime');
const allocator = require('../services/sending-account-allocator');
const { audit } = require('../services/audit');

const router = express.Router();

function authenticate(req, res, next) {
  const token = req.cookies?.access_token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, org: payload.org, roles: payload.roles || [] };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
router.use(authenticate);

function isPrivileged(req) {
  const role = String(req.user.roles?.[0] || '').toLowerCase();
  return ['owner', 'admin'].includes(role);
}
function requirePrivileged(req, res, next) {
  if (!isPrivileged(req)) {
    return res.status(403).json({ error: 'Only owners and admins can manage sending accounts' });
  }
  next();
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SECURITY_MODES = ['none', 'tls', 'ssl']; // none = plain SMTP (requires explicit confirmation)
const ISO_DAYS = ['1', '2', '3', '4', '5', '6', '7']; // 1=Mon … 7=Sun
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidTimezone(tz) {
  if (!tz) return true; // defaults to UTC
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: String(tz) });
    return true;
  } catch {
    return false;
  }
}

function validateSchedule(raw) {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'sendingSchedule must be an object keyed by ISO weekday (1-7)' };
  const out = {};
  for (const key of ISO_DAYS) {
    const day = raw[key];
    if (day === undefined) continue;
    if (day === null || typeof day !== 'object') return { ok: false, error: `sendingSchedule["${key}"] must be an object` };
    const enabled = day.enabled !== false;
    const start = String(day.start ?? '09:00');
    const end = String(day.end ?? '17:00');
    if (enabled && (!HHMM_RE.test(start) || !HHMM_RE.test(end))) {
      return { ok: false, error: `sendingSchedule["${key}"] start/end must be HH:MM` };
    }
    if (enabled && start >= end) {
      return { ok: false, error: `sendingSchedule["${key}"] start must be before end` };
    }
    out[key] = { enabled, start, end };
  }
  return { ok: true, value: out };
}

/** Shared POST/PATCH field validation. Returns { errors: [...] }. */
function validateAccountInput(body, { partial } = {}) {
  const errors = [];
  const emailKeys = ['fromEmail', 'replyToEmail'];
  for (const key of emailKeys) {
    if (body[key] !== undefined && body[key] !== null && body[key] !== '' && !EMAIL_RE.test(String(body[key]))) {
      errors.push(`${key} must be a valid email address`);
    }
  }
  if (body.name !== undefined && String(body.name).trim() === '') errors.push('name cannot be empty');
  const daily = body.dailyLimit !== undefined ? (body.dailyLimit === null ? null : parseInt(body.dailyLimit, 10)) : undefined;
  const hourly = body.hourlyLimit !== undefined ? (body.hourlyLimit === null ? null : parseInt(body.hourlyLimit, 10)) : undefined;
  if (daily !== undefined && daily !== null && (Number.isNaN(daily) || daily < 1)) errors.push('dailyLimit must be a positive integer');
  if (hourly !== undefined && hourly !== null && (Number.isNaN(hourly) || hourly < 1)) errors.push('hourlyLimit must be a positive integer');
  if (daily != null && hourly != null && hourly > daily) errors.push('hourlyLimit cannot exceed dailyLimit');
  const minD = body.minDelayMinutes !== undefined ? parseInt(body.minDelayMinutes, 10) : undefined;
  const maxD = body.maxDelayMinutes !== undefined ? parseInt(body.maxDelayMinutes, 10) : undefined;
  if (minD !== undefined && (Number.isNaN(minD) || minD < 0)) errors.push('minDelayMinutes must be >= 0');
  if (maxD !== undefined && (Number.isNaN(maxD) || maxD < 0)) errors.push('maxDelayMinutes must be >= 0');
  if (minD !== undefined && maxD !== undefined && minD > maxD) errors.push('minDelayMinutes cannot exceed maxDelayMinutes');
  if (body.timezone !== undefined && !isValidTimezone(body.timezone)) errors.push('timezone must be an IANA identifier (e.g. America/New_York)');
  if (body.minimumWaitMinutes !== undefined) {
    const n = parseInt(body.minimumWaitMinutes, 10);
    if (Number.isNaN(n) || n < 0) errors.push('minimumWaitMinutes must be 0 or more');
  }
  if (body.sendingSchedule !== undefined) {
    const check = validateSchedule(body.sendingSchedule);
    if (!check.ok) errors.push(check.error);
  }
  if (body.security !== undefined && !SECURITY_MODES.includes(body.security)) {
    errors.push(`security must be one of ${SECURITY_MODES.join(', ')}`);
  }
  return { errors };
}

async function serializeAccount(account, { withUsage } = {}) {
  const out = {
    id: account.id,
    name: account.name,
    smtpHost: account.smtpHost,
    smtpPort: account.smtpPort,
    security: account.security,
    smtpUsername: account.smtpUsername,
    hasPassword: Boolean(account.smtpPasswordEncrypted), // never the password itself
    fromEmail: account.fromEmail,
    fromName: account.fromName,
    replyToEmail: account.replyToEmail,
    dailyLimit: account.dailyLimit,
    hourlyLimit: account.hourlyLimit,
    minDelayMinutes: account.minDelayMinutes,
    maxDelayMinutes: account.maxDelayMinutes,
    minimumWaitMinutes: account.minimumWaitMinutes ?? 1,
    isEnabled: account.isEnabled,
    status: account.status,
    healthStatus: account.healthStatus || 'unknown',
    warmupStatus: account.warmupStatus || 'not_started',
    warmupDailyLimit: account.warmupDailyLimit ?? null,
    timezone: account.timezone || 'UTC',
    sendingSchedule: account.sendingSchedule || null,
    lastSentAt: account.lastSentAt,
    lastTestedAt: account.lastTestedAt,
    lastTestResult: account.lastTestResult,
    signatureMode: account.signatureMode,
    signatureId: account.signatureId,
    createdAt: account.createdAt,
  };
  if (withUsage) {
    const { dayUsed, hourUsed } = await allocator.peekUsage(account.id);
    const activeCampaigns = await models.CampaignSendingAccount.count({
      where: { smtpAccountId: account.id, enabled: true },
    }).catch(() => 0);
    out.sentToday = dayUsed;
    out.sentThisHour = hourUsed;
    out.remainingToday = account.dailyLimit != null ? Math.max(0, account.dailyLimit - dayUsed) : null;
    out.remainingThisHour = account.hourlyLimit != null ? Math.max(0, account.hourlyLimit - hourUsed) : null;
    out.activeCampaigns = activeCampaigns;
  }
  return out;
}

async function loadScoped(req, res) {
  const account = await models.SmtpAccount.findOne({
    where: { id: req.params.id, organizationId: req.user.org },
  });
  if (!account) {
    res.status(404).json({ error: 'Sending account not found' });
    return null;
  }
  return account;
}

// GET /api/v1/email-sending/accounts — list with live today/hour usage.
router.get('/accounts', async (req, res) => {
  try {
    const accounts = await models.SmtpAccount.findAll({
      where: { organizationId: req.user.org },
      order: [['created_at', 'ASC']],
    });
    const data = await Promise.all(accounts.map((a) => serializeAccount(a, { withUsage: true })));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load sending accounts' });
  }
});

// GET /api/v1/email-sending/accounts/:id — single account (+usage+health).
router.get('/accounts/:id', async (req, res) => {
  try {
    const account = await loadScoped(req, res);
    if (!account) return;
    res.json({ success: true, data: await serializeAccount(account, { withUsage: true }) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load sending account' });
  }
});

// GET /api/v1/email-sending/accounts/:id/health — derived health (§34/51).
router.get('/accounts/:id/health', async (req, res) => {
  try {
    const account = await loadScoped(req, res);
    if (!account) return;
    const [sent30d, failed30d, bounced30d] = await Promise.all([
      models.EmailEvent.count({ where: { organizationId: req.user.org, sendingAccountId: account.id, eventType: 'SENT' } }),
      models.EmailEvent.count({ where: { organizationId: req.user.org, sendingAccountId: account.id, eventType: 'FAILED' } }),
      models.EmailEvent.count({ where: { organizationId: req.user.org, sendingAccountId: account.id, eventType: 'BOUNCED' } }),
    ]);
    const failureRate = sent30d + failed30d > 0 ? failed30d / (sent30d + failed30d) : 0;
    // Derive health: explicit last-test failure dominates; recent failure rate can escalate to critical.
    let healthStatus = account.healthStatus || 'unknown';
    if (account.status === 'error' || (account.healthStatus === 'critical')) healthStatus = 'critical';
    else if (failureRate >= 0.5 && failed30d >= 5) healthStatus = 'critical';
    else if (failureRate >= 0.2 && failed30d >= 3) healthStatus = 'warning';
    res.json({
      success: true,
      data: {
        accountId: account.id,
        healthStatus,
        smtpStatus: account.status,
        warmupStatus: account.warmupStatus || 'not_started',
        lastTestedAt: account.lastTestedAt,
        lastTestResult: account.lastTestResult,
        last30Days: { sent: sent30d, failed: failed30d, bounced: bounced30d, failureRate: Math.round(failureRate * 1000) / 10 },
        lastSentAt: account.lastSentAt,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load account health' });
  }
});

// GET usage/health detail for the account drawer (§42).
router.get('/accounts/:id/usage', async (req, res) => {
  try {
    const account = await loadScoped(req, res);
    if (!account) return;
    const { dayUsed, hourUsed } = await allocator.peekUsage(account.id);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [sent30d, failed30d, bounced30d, replied30d] = await Promise.all([
      models.EmailEvent.count({ where: { organizationId: req.user.org, sendingAccountId: account.id, eventType: 'SENT' } }),
      models.EmailEvent.count({ where: { organizationId: req.user.org, sendingAccountId: account.id, eventType: 'FAILED' } }),
      models.EmailEvent.count({ where: { organizationId: req.user.org, sendingAccountId: account.id, eventType: 'BOUNCED' } }),
      models.EmailEvent.count({ where: { organizationId: req.user.org, sendingAccountId: account.id, eventType: 'REPLIED' } }),
    ]);
    void since;
    const activeCampaigns = await models.CampaignSendingAccount.count({
      where: { smtpAccountId: account.id, enabled: true },
    }).catch(() => 0);
    res.json({
      success: true,
      data: {
        sentToday: dayUsed,
        sentThisHour: hourUsed,
        dailyLimit: account.dailyLimit,
        hourlyLimit: account.hourlyLimit,
        remainingToday: account.dailyLimit != null ? Math.max(0, account.dailyLimit - dayUsed) : null,
        remainingThisHour: account.hourlyLimit != null ? Math.max(0, account.hourlyLimit - hourUsed) : null,
        lastSentAt: account.lastSentAt,
        activeCampaigns,
        last30Days: { sent: sent30d, failed: failed30d, bounced: bounced30d, replied: replied30d },
        healthStatus: account.healthStatus || 'unknown',
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load account usage' });
  }
});

// POST /api/v1/email-sending/accounts — privileged create.
router.post('/accounts', requirePrivileged, async (req, res) => {
  try {
    const {
      name, smtpHost, smtpPort, security, smtpUsername, smtpPassword,
      fromEmail, fromName, replyToEmail, dailyLimit, hourlyLimit,
      minDelayMinutes, maxDelayMinutes, minimumWaitMinutes, timezone, sendingSchedule,
      warmupDailyLimit,
    } = req.body || {};

    if (!name || !smtpHost || !smtpPort || !fromEmail) {
      return res.status(422).json({ error: 'name, smtpHost, smtpPort and fromEmail are required' });
    }
    if (!EMAIL_RE.test(String(fromEmail))) {
      return res.status(422).json({ error: 'fromEmail must be a valid email address' });
    }
    const { errors } = validateAccountInput(req.body, { partial: false });
    if (errors.length) return res.status(422).json({ error: errors.join('. ') });

    const scheduleCheck = validateSchedule(sendingSchedule === undefined ? null : sendingSchedule);
    const account = await models.SmtpAccount.create({
      organizationId: req.user.org,
      createdBy: req.user.id,
      name,
      smtpHost,
      smtpPort: parseInt(smtpPort, 10) || 587,
      security: SECURITY_MODES.includes(security) ? security : 'tls',
      smtpUsername: smtpUsername || null,
      smtpPasswordEncrypted: smtpPassword ? encryptSecret(smtpPassword) : null,
      fromEmail,
      fromName: fromName || null,
      replyToEmail: replyToEmail || null,
      dailyLimit: dailyLimit ? parseInt(dailyLimit, 10) : null,
      hourlyLimit: hourlyLimit ? parseInt(hourlyLimit, 10) : null,
      minDelayMinutes: minDelayMinutes ? parseInt(minDelayMinutes, 10) : 0,
      maxDelayMinutes: maxDelayMinutes ? parseInt(maxDelayMinutes, 10) : 0,
      minimumWaitMinutes: minimumWaitMinutes !== undefined ? Math.max(0, parseInt(minimumWaitMinutes, 10) || 0) : 1,
      timezone: timezone || 'UTC',
      sendingSchedule: scheduleCheck.ok ? scheduleCheck.value : null,
      warmupDailyLimit: warmupDailyLimit ? parseInt(warmupDailyLimit, 10) : null,
      isEnabled: true,
      status: 'unverified',
      healthStatus: 'unknown',
      warmupStatus: 'not_started',
    });

    res.status(201).json({ success: true, data: await serializeAccount(account, { withUsage: true }) });
    realtime.emitAccountsChanged(req.user.org, account.id, req.headers['x-client-id']);
    audit(req.user.org, req.user.id, 'sending_account.created', 'smtp_account', account.id, { name: account.name, fromEmail: account.fromEmail });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create sending account' });
  }
});

// PATCH /api/v1/email-sending/accounts/:id — privileged update.
router.patch('/accounts/:id', requirePrivileged, async (req, res) => {
  try {
    const account = await loadScoped(req, res);
    if (!account) return;

    const { errors } = validateAccountInput(req.body, { partial: true });
    // Cross-field check against MERGED values (account + patch).
    const mergedDaily = req.body.dailyLimit !== undefined
      ? (req.body.dailyLimit === null ? null : parseInt(req.body.dailyLimit, 10))
      : account.dailyLimit;
    const mergedHourly = req.body.hourlyLimit !== undefined
      ? (req.body.hourlyLimit === null ? null : parseInt(req.body.hourlyLimit, 10))
      : account.hourlyLimit;
    if (mergedDaily != null && mergedHourly != null && mergedHourly > mergedDaily) {
      errors.push('hourlyLimit cannot exceed dailyLimit');
    }
    const mergedMin = req.body.minDelayMinutes !== undefined ? parseInt(req.body.minDelayMinutes, 10) : (account.minDelayMinutes || 0);
    const mergedMax = req.body.maxDelayMinutes !== undefined ? parseInt(req.body.maxDelayMinutes, 10) : (account.maxDelayMinutes || 0);
    if (mergedMin > mergedMax) errors.push('minDelayMinutes cannot exceed maxDelayMinutes');
    if (errors.length) return res.status(422).json({ error: errors.join('. ') });

    const allowed = ['name', 'smtpHost', 'security', 'fromEmail', 'fromName', 'replyToEmail', 'timezone'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) account[key] = req.body[key];
    }
    if (req.body.fromName === undefined && req.body.name !== undefined) {
      account.fromName = req.body.name;
    }
    if (req.body.smtpPort !== undefined) account.smtpPort = parseInt(req.body.smtpPort, 10) || 587;
    if (req.body.smtpUsername !== undefined) account.smtpUsername = req.body.smtpUsername;
    if (req.body.smtpPassword) account.smtpPasswordEncrypted = encryptSecret(req.body.smtpPassword);
    if (req.body.isEnabled !== undefined) account.isEnabled = Boolean(req.body.isEnabled);
    if (req.body.dailyLimit !== undefined) account.dailyLimit = mergedDaily;
    if (req.body.hourlyLimit !== undefined) account.hourlyLimit = mergedHourly;
    if (req.body.minDelayMinutes !== undefined) account.minDelayMinutes = parseInt(req.body.minDelayMinutes, 10) || 0;
    if (req.body.minimumWaitMinutes !== undefined) account.minimumWaitMinutes = Math.max(0, parseInt(req.body.minimumWaitMinutes, 10) || 0);
    if (req.body.maxDelayMinutes !== undefined) account.maxDelayMinutes = parseInt(req.body.maxDelayMinutes, 10) || 0;
    if (req.body.warmupDailyLimit !== undefined) account.warmupDailyLimit = req.body.warmupDailyLimit ? parseInt(req.body.warmupDailyLimit, 10) : null;
    if (req.body.warmupStatus !== undefined) {
      const allowedWarmup = ['not_started', 'warming', 'active', 'paused', 'completed'];
      if (!allowedWarmup.includes(req.body.warmupStatus)) {
        return res.status(422).json({ error: `warmupStatus must be one of ${allowedWarmup.join(', ')}` });
      }
      account.warmupStatus = req.body.warmupStatus;
    }
    if (req.body.sendingSchedule !== undefined) {
      const check = validateSchedule(req.body.sendingSchedule);
      if (!check.ok) return res.status(422).json({ error: check.error });
      account.sendingSchedule = check.value;
    }
    if (req.body.signatureMode !== undefined) {
      const m = String(req.body.signatureMode).toLowerCase();
      if (!['inherit', 'custom', 'none'].includes(m)) {
        return res.status(422).json({ error: 'signatureMode must be inherit, custom or none' });
      }
      account.signatureMode = m;
      if (m !== 'custom') account.signatureId = null;
    }
    if (req.body.signatureId !== undefined) {
      account.signatureId = req.body.signatureId || null;
      if (account.signatureId) account.signatureMode = 'custom';
    }

    await account.save();
    res.json({ success: true, data: await serializeAccount(account, { withUsage: true }) });
    realtime.emitAccountsChanged(req.user.org, account.id, req.headers['x-client-id']);
    audit(req.user.org, req.user.id, req.body.smtpPassword ? 'sending_account.credentials_changed' : 'sending_account.updated',
      'smtp_account', account.id, { fields: Object.keys(req.body || {}).filter((k) => !/pass/i.test(k)) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update sending account' });
  }
});

// POST pause / resume (drawer actions) — privileged.
router.post('/accounts/:id/pause', requirePrivileged, async (req, res) => {
  try {
    const account = await loadScoped(req, res);
    if (!account) return;
    account.isEnabled = false;
    await account.save();
    realtime.emitAccountsChanged(req.user.org, account.id, req.headers['x-client-id']);
    audit(req.user.org, req.user.id, 'sending_account.paused', 'smtp_account', account.id, {});
    res.json({ success: true, data: await serializeAccount(account, { withUsage: true }) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to pause account' });
  }
});
router.post('/accounts/:id/resume', requirePrivileged, async (req, res) => {
  try {
    const account = await loadScoped(req, res);
    if (!account) return;
    account.isEnabled = true;
    await account.save();
    realtime.emitAccountsChanged(req.user.org, account.id, req.headers['x-client-id']);
    audit(req.user.org, req.user.id, 'sending_account.resumed', 'smtp_account', account.id, {});
    res.json({ success: true, data: await serializeAccount(account, { withUsage: true }) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to resume account' });
  }
});

// DELETE /api/v1/email-sending/accounts/:id — privileged. Refuses while any
// campaign pool still references the account (pool FKs are ON DELETE CASCADE,
// so remove memberships explicitly or use removeAccountFromCampaign flow).
router.delete('/accounts/:id', requirePrivileged, async (req, res) => {
  try {
    const account = await loadScoped(req, res);
    if (!account) return;

    const poolUse = await models.CampaignSendingAccount.count({ where: { smtpAccountId: account.id } });
    const legacyUse = await models.Campaign.count({ where: { sendingAccountId: account.id } });
    if (poolUse > 0 || legacyUse > 0) {
      return res.status(409).json({
        error: `Account is assigned to ${poolUse + legacyUse} campaign(s). Remove it from their sending pools first.`,
      });
    }
    await account.destroy();
    audit(req.user.org, req.user.id, 'sending_account.deleted', 'smtp_account', account.id, { fromEmail: account.fromEmail });
    res.json({ success: true, data: { id: account.id } });
    realtime.emitAccountsChanged(req.user.org, account.id, req.headers['x-client-id']);
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete sending account' });
  }
});

// POST /api/v1/email-sending/accounts/:id/test — real SMTP verify, privileged.
router.post('/accounts/:id/test', requirePrivileged, async (req, res) => {
  try {
    const account = await loadScoped(req, res);
    if (!account) return;

    const result = await emailService.testConnection(account);
    // Health is derived from real SMTP behaviour (§34): 3 consecutive failures
    // → critical; 1-2 → warning; success → healthy.
    const nextHealth = result.ok ? 'healthy' : (account.healthStatus === 'warning' ? 'critical' : 'warning');
    await account.update({
      lastTestedAt: new Date(),
      lastTestResult: result.ok ? 'success' : result.message,
      status: result.ok ? 'verified' : 'error',
      healthStatus: result.ok ? 'healthy' : nextHealth,
    });
    res.json({ success: result.ok, message: result.message, failureClass: result.class || null, healthy: result.ok });
    realtime.emitAccountsChanged(req.user.org, account.id, req.headers['x-client-id']);
    audit(req.user.org, req.user.id, 'sending_account.smtp_tested', 'smtp_account', account.id, { ok: result.ok, failureClass: result.class || null });
  } catch (error) {
    res.status(500).json({ error: 'SMTP connection test failed.' });
  }
});

// (POST /accounts/:id/test-connection is an alias the frontend may use; the
// canonical endpoint is /test. Both call the same real SMTP verification.)
router.post('/accounts/:id/test-connection', requirePrivileged, async (req, res, next) => {
  // Rewrite path to /test and re-dispatch to this same router.
  req.url = `/accounts/${req.params.id}/test`;
  router.handle(req, res, next);
});

// POST /api/v1/email-sending/accounts/:id/send-test — privileged, real send.
router.post('/accounts/:id/send-test', requirePrivileged, async (req, res) => {
  try {
    const { to, subject, body } = req.body || {};
    if (!to || !EMAIL_RE.test(String(to))) {
      return res.status(422).json({ error: 'A valid test email address is required' });
    }
    const account = await loadScoped(req, res);
    if (!account) return;
    if (!account.isEnabled) return res.status(400).json({ error: 'Account is disabled. Enable it first.' });

    const finalSubject = String(subject || '').trim().slice(0, 200) || 'SalesFire test email';
    const textBody = String(body || '').trim() ||
      'This is a test email from SalesFire. If you received it, your SMTP settings work.';
    const htmlBody = `<p>${textBody.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</p>`;

    const result = await emailService.sendEmail(account, {
      to,
      subject: finalSubject,
      text: textBody,
      html: htmlBody,
    });
    if (!result.ok) {
      // Record FAILED event without a recipient/campaign — test traffic never
      // pollutes campaign statistics, but SMTP failure intelligence is real.
      models.EmailEvent.create({
        organizationId: req.user.org,
        sendingAccountId: account.id,
        eventType: 'FAILED',
        metadata: { test: true, failureClass: result.failureClass },
      }).catch(() => {});
      return res.status(502).json({ success: false, error: result.error, failureClass: result.failureClass });
    }
    models.EmailEvent.create({
      organizationId: req.user.org,
      sendingAccountId: account.id,
      eventType: 'SENT',
      messageId: result.messageId,
      metadata: { test: true },
    }).catch(() => {});
    res.json({ success: true, message: 'Test email sent.', messageId: result.messageId });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send test email.' });
  }
});

// GET /api/v1/email-sending/overview — org-level sending analytics (§45).
router.get('/overview', async (req, res) => {
  try {
    const org = req.user.org;
    const accounts = await models.SmtpAccount.findAll({ where: { organizationId: org } });
    const active = accounts.filter((a) => a.isEnabled).length;
    const errors = accounts.filter((a) => String(a.status) === 'error').length;
    let sentToday = 0, remaining = 0, limited = 0;
    for (const a of accounts) {
      const { dayUsed } = await allocator.peekUsage(a.id);
      sentToday += dayUsed;
      if (a.dailyLimit != null && a.isEnabled) {
        remaining += Math.max(0, a.dailyLimit - dayUsed);
        limited++;
      }
    }
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    void since;
    const [bounces, replies, failed] = await Promise.all([
      models.EmailEvent.count({ where: { organizationId: org, eventType: 'BOUNCED' } }),
      models.EmailEvent.count({ where: { organizationId: org, eventType: 'REPLIED' } }),
      models.EmailEvent.count({ where: { organizationId: org, eventType: 'FAILED' } }),
    ]);
    res.json({
      success: true,
      data: {
        totalAccounts: accounts.length,
        activeAccounts: active,
        accountsWithErrors: errors,
        emailsSentToday: sentToday,
        // null = no account has a daily limit set (uncapped) — the UI shows ∞.
        remainingCapacityToday: limited > 0 ? remaining : null,
        bounces,
        replies,
        failedSends: failed,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load sending overview' });
  }
});

module.exports = router;
