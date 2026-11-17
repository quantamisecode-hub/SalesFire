// Email-sending (SMTP) account routes - Prompt 6 §27-31.
// Passwords: AES-256-GCM encrypted at rest, never returned to any client.
const express = require('express');
const models = require('../models');
const { verifyAccessToken } = require('../security');
const emailService = require('../services/email');
const { encryptSecret } = require('../services/crypto');
const realtime = require('../services/realtime');

const router = express.Router();

// All routes require auth
function authenticate(req, res, next) {
  const token = req.cookies?.access_token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, org: payload.org, roles: payload.roles };
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
router.use(authenticate);

function serializeAccount(account) {
  // NOTE: never include smtpPasswordEncrypted
  return {
    id: account.id,
    name: account.name,
    smtpHost: account.smtpHost,
    smtpPort: account.smtpPort,
    security: account.security,
    smtpUsername: account.smtpUsername,
    hasPassword: Boolean(account.smtpPasswordEncrypted),
    fromEmail: account.fromEmail,
    fromName: account.fromName,
    replyToEmail: account.replyToEmail,
    dailyLimit: account.dailyLimit,
    hourlyLimit: account.hourlyLimit,
    minDelayMinutes: account.minDelayMinutes,
    maxDelayMinutes: account.maxDelayMinutes,
    isEnabled: account.isEnabled,
    status: account.status,
    lastTestedAt: account.lastTestedAt,
    lastTestResult: account.lastTestResult,
    signatureMode: account.signatureMode,
    signatureId: account.signatureId,
    createdAt: account.createdAt,
  };
}

// GET /api/v1/email-sending/accounts
router.get('/accounts', async (req, res) => {
  try {
    const accounts = await models.SmtpAccount.findAll({
      where: { organizationId: req.user.org },
      order: [['created_at', 'ASC']],
    });
    res.json({ success: true, data: accounts.map(serializeAccount) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load sending accounts' });
  }
});

// POST /api/v1/email-sending/accounts
router.post('/accounts', async (req, res) => {
  try {
    const {
      name, smtpHost, smtpPort, security, smtpUsername, smtpPassword,
      fromEmail, fromName, replyToEmail, dailyLimit, hourlyLimit,
      minDelayMinutes, maxDelayMinutes,
    } = req.body || {};

    if (!name || !smtpHost || !smtpPort || !fromEmail) {
      return res.status(422).json({ error: 'name, smtpHost, smtpPort and fromEmail are required' });
    }

    const account = await models.SmtpAccount.create({
      organizationId: req.user.org,
      createdBy: req.user.id,
      name,
      smtpHost,
      smtpPort: parseInt(smtpPort, 10) || 587,
      security: ['none', 'tls', 'ssl'].includes(security) ? security : 'tls',
      smtpUsername: smtpUsername || null,
      smtpPasswordEncrypted: smtpPassword ? encryptSecret(smtpPassword) : null,
      fromEmail,
      fromName: fromName || null,
      replyToEmail: replyToEmail || null,
      dailyLimit: dailyLimit ? parseInt(dailyLimit, 10) : null,
      hourlyLimit: hourlyLimit ? parseInt(hourlyLimit, 10) : null,
      minDelayMinutes: minDelayMinutes ? parseInt(minDelayMinutes, 10) : 0,
      maxDelayMinutes: maxDelayMinutes ? parseInt(maxDelayMinutes, 10) : 0,
      isEnabled: true,
      status: 'unverified',
    });

    res.status(201).json({ success: true, data: serializeAccount(account) });
    realtime.emitAccountsChanged(req.user.org, account.id, req.headers['x-client-id']);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create sending account' });
  }
});

// PATCH /api/v1/email-sending/accounts/:id
router.patch('/accounts/:id', async (req, res) => {
  try {
    const account = await models.SmtpAccount.findOne({
      where: { id: req.params.id, organizationId: req.user.org },
    });
    if (!account) return res.status(404).json({ error: 'Sending account not found' });

    const allowed = ['name', 'smtpHost', 'security', 'fromEmail', 'fromName', 'replyToEmail'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) account[key] = req.body[key];
    }
    // Spec: "Display Name if changed should show the same new name in From Name" —
    // renaming the account's display name without an explicit fromName update follows.
    if (req.body.fromName === undefined && req.body.name !== undefined) {
      account.fromName = req.body.name;
    }
    if (req.body.smtpPort !== undefined) account.smtpPort = parseInt(req.body.smtpPort, 10) || 587;
    if (req.body.smtpUsername !== undefined) account.smtpUsername = req.body.smtpUsername;
    if (req.body.smtpPassword) account.smtpPasswordEncrypted = encryptSecret(req.body.smtpPassword);
    if (req.body.isEnabled !== undefined) account.isEnabled = Boolean(req.body.isEnabled);
    if (req.body.dailyLimit !== undefined) account.dailyLimit = req.body.dailyLimit ? parseInt(req.body.dailyLimit, 10) : null;
    if (req.body.hourlyLimit !== undefined) account.hourlyLimit = req.body.hourlyLimit ? parseInt(req.body.hourlyLimit, 10) : null;
    if (req.body.minDelayMinutes !== undefined) account.minDelayMinutes = parseInt(req.body.minDelayMinutes, 10) || 0;
    if (req.body.maxDelayMinutes !== undefined) account.maxDelayMinutes = parseInt(req.body.maxDelayMinutes, 10) || 0;
    // Prompt 9 — signature resolution selection.
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
    res.json({ success: true, data: serializeAccount(account) });
    realtime.emitAccountsChanged(req.user.org, account.id, req.headers['x-client-id']);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update sending account' });
  }
});

// DELETE /api/v1/email-sending/accounts/:id
router.delete('/accounts/:id', async (req, res) => {
  try {
    const account = await models.SmtpAccount.findOne({
      where: { id: req.params.id, organizationId: req.user.org },
    });
    if (!account) return res.status(404).json({ error: 'Sending account not found' });

    const inUse = await models.Campaign.count({ where: { sendingAccountId: account.id } });
    if (inUse > 0) {
      return res.status(409).json({ error: `Account is used by ${inUse} campaign(s). Detach them first.` });
    }
    await account.destroy();
    res.json({ success: true, data: { id: account.id } });
    realtime.emitAccountsChanged(req.user.org, account.id, req.headers['x-client-id']);
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete sending account' });
  }
});

// POST /api/v1/email-sending/accounts/:id/test - real SMTP connection attempt
router.post('/accounts/:id/test', async (req, res) => {
  try {
    const account = await models.SmtpAccount.findOne({
      where: { id: req.params.id, organizationId: req.user.org },
    });
    if (!account) return res.status(404).json({ error: 'Sending account not found' });

    const result = await emailService.testConnection(account);
    await account.update({
      lastTestedAt: new Date(),
      lastTestResult: result.ok ? 'success' : result.message,
      status: result.ok ? 'verified' : 'error',
    });
    res.json({ success: result.ok, message: result.message, failureClass: result.class || null });
    realtime.emitAccountsChanged(req.user.org, account.id, req.headers['x-client-id']);
  } catch (error) {
    res.status(500).json({ error: 'SMTP connection test failed.' });
  }
});

// POST /api/v1/email-sending/accounts/:id/send-test - real send to a test address.
// Test emails are NOT campaign recipients and do not affect analytics.
router.post('/accounts/:id/send-test', async (req, res) => {
  try {
    const { to } = req.body || {};
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      return res.status(422).json({ error: 'A valid test email address is required' });
    }
    const account = await models.SmtpAccount.findOne({
      where: { id: req.params.id, organizationId: req.user.org },
    });
    if (!account) return res.status(404).json({ error: 'Sending account not found' });
    if (!account.isEnabled) return res.status(400).json({ error: 'Account is disabled. Enable it first.' });

    const result = await emailService.sendEmail(account, {
      to,
      subject: 'SalesFire test email',
      text: 'This is a test email from SalesFire. If you received it, your SMTP settings work.',
      html: '<p>This is a <strong>test email</strong> from SalesFire. If you received it, your SMTP settings work.</p>',
    });
    if (!result.ok) {
      return res.status(502).json({ success: false, error: result.error, failureClass: result.failureClass });
    }
    res.json({ success: true, message: 'Test email sent.', messageId: result.messageId });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send test email.' });
  }
});

module.exports = router;
