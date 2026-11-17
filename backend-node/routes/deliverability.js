// Deliverability routes — Email Verification + Warm-up (Prompt 8).
// Tenancy checks identical to other routers; all verdicts come from real
// verification runs — nothing is simulated.
const express = require('express');
const { Op } = require('sequelize');
const models = require('../models');
const { verifyEmail } = require('../services/email-verifier');
const { verifyAccessToken } = require('../security');
const warmup = require('../services/warmup');

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

function orgOrg(req, res, next) {
  if (!req.user.org) return res.status(403).json({ error: 'No organization membership' });
  next();
}
router.use(orgOrg);

function leadStatusFor(status) {
  switch (status) {
    case 'valid': return 'verified';
    case 'risky': return 'mx_valid';
    case 'invalid': return 'invalid';
    default: return 'unknown';
  }
}

async function persistVerification(orgId, leadId, email, result) {
  const row = await models.EmailVerification.create({
    organizationId: orgId,
    leadId: leadId || null,
    email: result.email,
    status: result.status,
    riskScore: result.riskScore,
    reasons: result.reasons,
    durationMs: result.durationMs,
    mxRecords: result.mxRecords,
  });
  if (leadId) {
    await models.Lead.update({ emailStatus: leadStatusFor(result.status) }, { where: { id: leadId, organizationId: orgId } });
  }
  return row;
}

// ---------------------------------------------------------------------------
// GET /api/v1/deliverability/verification?campaignId=... — stored verdicts for
// a campaign's enrolled leads (latest run per lead).
// ---------------------------------------------------------------------------
router.get('/verification', async (req, res) => {
  try {
    const { campaignId } = req.query;
    let leads;
    if (campaignId) {
      leads = await models.CampaignLead.findAll({
        where: { campaignId, organizationId: req.user.org },
        attributes: ['email', 'firstName', 'lastName'],
      });
    } else {
      leads = await models.Lead.findAll({
        where: { organizationId: req.user.org },
        attributes: ['email', 'firstName', 'lastName'],
        limit: 500,
      });
    }
    const emails = leads.map((l) => l.email);
    const rows = await models.EmailVerification.findAll({
      where: { organizationId: req.user.org, email: { [Op.in]: emails } },
      order: [['createdAt', 'DESC']],
    });
    const byEmail = new Map();
    for (const r of rows) {
      if (!byEmail.has(r.email)) byEmail.set(r.email, r); // latest wins
    }
    res.json({
      success: true,
      data: leads.map((l) => {
        const v = byEmail.get(l.email);
        return {
          email: l.email,
          firstName: l.firstName || null,
          lastName: l.lastName || null,
          verification: v ? {
            status: v.status,
            riskScore: v.riskScore,
            reasons: v.reasons || [],
            checkedAt: v.createdAt,
          } : null,
        };
      }),
    });
  } catch (error) {
    console.error('Verification list error:', error);
    res.status(500).json({ error: 'Failed to load verification results' });
  }
});

// POST /api/v1/deliverability/verify — verify one email (ad-hoc or lead-linked).
router.post('/verify', express.json(), async (req, res) => {
  try {
    const { email, leadId } = req.body || {};
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      return res.status(422).json({ error: 'A valid email address is required' });
    }
    let lead = null;
    if (leadId) {
      lead = await models.Lead.findOne({ where: { id: leadId, organizationId: req.user.org } });
      if (!lead) return res.status(404).json({ error: 'Lead not found' });
    }
    const result = await verifyEmail(email);
    await persistVerification(req.user.org, lead?.id, email, result);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// POST /api/v1/deliverability/verify-leads — verify existing leads in this org.
// Body: { leadIds?: string[], unverifiedOnly?: boolean, limit?: number }.
// Real DNS verification per lead; capped at 200 per call so batches stay sane.
router.post('/verify-leads', express.json(), async (req, res) => {
  try {
    const role = String(req.user.roles?.[0] || '').toLowerCase();
    if (!['owner', 'admin', 'member', 'editor', 'manager'].includes(role)) {
      return res.status(403).json({ error: 'You do not have permission' });
    }
    const { leadIds, unverifiedOnly = true, limit: rawLimit } = req.body || {};
    const limit = Math.min(200, Math.max(1, parseInt(rawLimit, 10) || 100));

    const where = { organizationId: req.user.org };
    if (Array.isArray(leadIds) && leadIds.length) where.id = { [Op.in]: leadIds.slice(0, 200) };
    else if (unverifiedOnly) where.emailStatus = { [Op.in]: ['unknown', 'syntax_valid', 'domain_valid', 'mx_valid', 'discovered'] };

    const leads = await models.Lead.findAll({ where, limit });
    const results = [];
    for (const lead of leads) {
      const result = await verifyEmail(lead.email);
      await persistVerification(req.user.org, lead.id, lead.email, result);
      results.push({ id: lead.id, email: lead.email, status: result.status, riskScore: result.riskScore });
    }
    const summary = results.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
    res.json({ success: true, data: { verified: results.length, summary, results } });
  } catch (error) {
    console.error('Bulk verify leads error:', error);
    res.status(500).json({ error: 'Bulk verification failed' });
  }
});

// POST /api/v1/deliverability/verify-campaign/:campaignId — bulk verify enrolled
// leads with real DNS checks (sequential to keep resolver load sane).
router.post('/verify-campaign/:campaignId', async (req, res) => {
  try {
    const campaign = await models.Campaign.findOne({
      where: { id: req.params.campaignId, organizationId: req.user.org },
    });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const enrolled = await models.CampaignLead.findAll({
      where: { campaignId: campaign.id, organizationId: req.user.org },
      attributes: ['email'],
    });
    const unique = [...new Set(enrolled.map((r) => r.email))];
    const results = [];
    for (const email of unique) {
      const lead = await models.Lead.findOne({
        where: { organizationId: req.user.org, email },
        attributes: ['id'],
      });
      const result = await verifyEmail(email);
      await persistVerification(req.user.org, lead?.id, email, result);
      results.push({ email, status: result.status, riskScore: result.riskScore });
    }
    const summary = results.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});
    res.json({ success: true, data: { verified: results.length, summary, results } });
  } catch (error) {
    console.error('Bulk verify error:', error);
    res.status(500).json({ error: 'Bulk verification failed' });
  }
});

// POST /api/v1/deliverability/verify-one/:leadId — verify a single lead.
router.post('/verify-one/:leadId', async (req, res) => {
  try {
    const lead = await models.Lead.findOne({
      where: { id: req.params.leadId, organizationId: req.user.org },
    });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const result = await verifyEmail(lead.email);
    await persistVerification(req.user.org, lead.id, lead.email, result);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Verify lead error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ---------------------------------------------------------------------------
// Warm-up (Prompt 8) — status + configuration.
// ---------------------------------------------------------------------------
router.get('/warmup', async (req, res) => {
  try {
    const accounts = await models.SmtpAccount.findAll({
      where: { organizationId: req.user.org },
      attributes: ['id', 'name', 'fromEmail', 'isEnabled', 'dailyLimit', 'hourlyLimit', 'status'],
      order: [['createdAt', 'ASC']],
    });
    const plans = await models.WarmupPlan.findAll({
      where: { organizationId: req.user.org },
      include: [{ model: models.SmtpAccount, as: 'account', attributes: ['id', 'name', 'fromEmail'] }],
    });
    const byAccount = new Map(plans.map((p) => [p.accountId, p]));
    const data = [];
    for (const a of accounts) {
      const plan = byAccount.get(a.id);
      data.push({
        account: { id: a.id, name: a.name, fromEmail: a.fromEmail, isEnabled: a.isEnabled, dailyLimit: a.dailyLimit, status: a.status },
        plan: plan ? await warmup.planSnapshot(plan) : null,
      });
    }
    res.json({ success: true, data });
  } catch (error) {
    console.error('Warm-up list error:', error);
    res.status(500).json({ error: 'Failed to load warm-up status' });
  }
});

// PUT /api/v1/deliverability/warmup/:accountId — enable/update/disable a plan.
router.put('/warmup/:accountId', express.json(), async (req, res) => {
  try {
    const account = await models.SmtpAccount.findOne({
      where: { id: req.params.accountId, organizationId: req.user.org },
    });
    if (!account) return res.status(404).json({ error: 'Sending account not found' });
    const { enabled, targetVolume, startVolume, rampStep, seedRecipients, reset } = req.body || {};

    let plan = await models.WarmupPlan.findOne({ where: { accountId: account.id } });
    if (enabled === false) {
      if (plan) await plan.update({ status: 'paused' });
      return res.json({ success: true, data: plan ? await warmup.planSnapshot(plan) : null });
    }

    const clampInt = (v, def, min, max) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
    };
    const target = clampInt(targetVolume, plan?.targetVolume ?? 40, 1, 500);
    const start = clampInt(startVolume, plan?.startVolume ?? 2, 1, 100);
    const step = clampInt(rampStep, plan?.rampStep ?? 2, 1, 100);
    if (start > target) return res.status(422).json({ error: 'startVolume cannot exceed targetVolume' });

    // Seed recipients are sanitized: invalid addresses are rejected with the list.
    let seedValue;
    if (typeof seedRecipients === 'string') {
      const parts = seedRecipients.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const bad = parts.filter((s) => !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s));
      if (bad.length) {
        return res.status(422).json({ error: `Invalid seed recipient(s): ${bad.join(', ')}` });
      }
      seedValue = parts.join(', ');
    }

    if (plan) {
      const updates = { targetVolume: target, startVolume: start, rampStep: step };
      if (seedValue !== undefined) updates.seedRecipients = seedValue || null;
      if (reset) {
        Object.assign(updates, {
          status: 'active',
          sentToday: 0, sentTodayDate: null, totalSent: 0, totalFailed: 0,
          startedOn: new Date().toISOString().slice(0, 10), consecutiveFailureDays: 0,
        });
      } else if (enabled === true) {
        updates.status = 'active';
      }
      plan = await plan.update(updates);
      return res.json({ success: true, data: await warmup.planSnapshot(plan) });
    }

    // No plan yet: create one — active only when the caller explicitly enables it,
    // otherwise paused (nothing is sent until the account actually works).
    plan = await models.WarmupPlan.create({
      organizationId: req.user.org,
      accountId: account.id,
      status: enabled === true || reset ? 'active' : 'paused',
      targetVolume: target, startVolume: start, rampStep: step,
      seedRecipients: seedValue !== undefined ? (seedValue || null) : null,
    });
    res.json({ success: true, data: await warmup.planSnapshot(plan) });
  } catch (error) {
    console.error('Warm-up config error:', error);
    res.status(500).json({ error: 'Failed to update warm-up plan' });
  }
});

module.exports = router;
