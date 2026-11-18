// Campaign Routes - Prompt 5 AI Outreach & Campaign Engine
const express = require('express');
const router = express.Router();
const models = require('../models');
const { sequelize } = require('../db');
const { Op } = require('sequelize');
const { Campaign } = models;
const { verifyAccessToken, verifyRefreshToken, isSafeUrl } = require('../security');
const { generateAccessToken, generateRefreshToken } = require('../auth');
const templateRenderer = require('../services/template-renderer');
const emailService = require('../services/email');
const engine = require('../services/campaign-engine');
const realtime = require('../services/realtime'); // no-op when sockets aren't initialized (tests)
const leadFilter = require('../services/lead-filter');
const leadMove = require('../services/lead-move');

// Middleware: authenticate JWT from cookie
function authenticate(req, res, next) {
  try {
    const token = req.cookies.access_token;
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized - no access token' });
    }
    
    const payload = verifyAccessToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Unauthorized - invalid access token' });
    }
    
    // Attach user org to request
    req.user = { id: payload.sub, org: payload.org };
    next();
  } catch (error) {
    res.status(401).json({ error: 'Unauthorized - token validation failed' });
  }
}

// Middleware: verify authentication + organization membership.
// Works as a direct middleware (routes use it bare: `checkOrgMembership`).
// The JWT 'org' claim identifies the organization; per-route role checks can
// wrap this factory-style later if needed.
async function checkOrgMembership(req, res, next) {
  try {
    const { user } = req;
    if (!user || !user.org) {
      return res.status(401).json({ error: 'Unauthenticated' });
    }
    next();
  } catch (error) {
    res.status(500).json({ error: 'Membership check failed' });
  }
}

// ============================================================================
// Campaign CRUD Routes
// ============================================================================

// POST /api/v1/campaigns - Create campaign
router.post('/', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const { name, description, campaignType, ...data } = req.body;
    
    const campaign = await Campaign.create({
      ...data,
      organizationId: req.user.org,
      createdBy: req.user.id,
      name,
      description,
      campaignType,
    });
    
    res.status(201).json({
      success: true,
      data: campaign,
    });
  } catch (error) {
    console.error('Create campaign error:', error);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

// GET /api/v1/campaigns - List campaigns (server-side pagination/search/sort)
router.get('/', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
    const status = req.query.status;
    const type = req.query.campaignType;
    const search = (req.query.search || '').trim();
    const sortBy = ['name', 'status', 'createdAt', 'scheduledStartAt', 'totalLeads'].includes(req.query.sortBy)
      ? req.query.sortBy
      : 'createdAt';
    const sortDir = req.query.sortDir === 'asc' ? 'ASC' : 'DESC';

    const where = { organizationId: req.user.org };
    if (status && status !== 'all') where.status = status;
    if (type) where.campaignType = type;
    if (search) {
      where.name = { [require('sequelize').Op.like]: `%${search}%` };
    }

    const { count, rows } = await Campaign.findAndCountAll({
      where,
      order: [[sortBy, sortDir]],
      offset: (page - 1) * pageSize,
      limit: pageSize,
    });

    res.json({
      success: true,
      data: rows,
      pagination: {
        page,
        pageSize,
        total: count,
        pages: Math.ceil(count / pageSize) || 1,
      },
    });
  } catch (error) {
    console.error('List campaigns error:', error);
    res.status(500).json({ error: 'Failed to list campaigns' });
  }
});

// GET /api/v1/campaigns/:id - Get campaign
router.get('/:id', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      where: { id: req.params.id, organizationId: req.user.org },
      include: [
        { model: models.Organization, as: 'organization' },
        { model: models.CampaignSequence, as: 'sequel' },
      ],
    });
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    res.json({ success: true, data: campaign });
  } catch (error) {
    console.error('Get campaign error:', error);
    res.status(500).json({ error: 'Failed to get campaign' });
  }
});

// PUT /api/v1/campaigns/:id - Update campaign (field allowlist = mass-assignment protection)
router.put('/:id', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      where: { id: req.params.id, organizationId: req.user.org },
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Drafts and paused campaigns are editable — pausing must not lock the
    // editor (user-facing edits re-check content at send time, §19/§41).
    if (['scheduled', 'active', 'completed', 'cancelled', 'archived'].includes(campaign.status)) {
      return res.status(400).json({ error: `Cannot edit a campaign while it is ${campaign.status}` });
    }

    const allowed = [
      'name', 'description', 'campaignType', 'timezone', 'sendingAccountId',
      'maxEmailsPerDay', 'maxEmailsPerLead', 'sendBetweenStartHour', 'sendBetweenEndHour',
      'sendDaysOfWeek', 'dailyLimit', 'hourlyLimit', 'minDelayMinutes', 'maxDelayMinutes',
      'scheduledStartAt', 'scheduledEndAt', 'aiPersonalizationEnabled', 'aiPersonalizationDepth',
      'aiApprovalRequired', 'signatureMode', 'signatureId',
    ];
    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      if (key === 'signatureMode') {
        if (!['inherit', 'custom', 'none'].includes(String(req.body[key]).toLowerCase())) {
          return res.status(422).json({ error: 'signatureMode must be inherit, custom or none' });
        }
        campaign.signatureMode = String(req.body[key]).toLowerCase();
        // NONE requires no id; INHERIT clears any custom id.
        if (campaign.signatureMode !== 'custom') campaign.signatureId = null;
        continue;
      }
      if (key === 'signatureId') {
        campaign.signatureId = req.body[key] || null;
        if (campaign.signatureId && !['custom'].includes(campaign.signatureMode)) campaign.signatureMode = 'custom';
        continue;
      }
      campaign[key] = req.body[key];
    }
    await campaign.save();
    realtime.emitCampaignUpdated(campaign, req.headers['x-client-id']);
    res.json({ success: true, data: campaign });
  } catch (error) {
    console.error('Update campaign error:', error);
    res.status(500).json({ error: 'Failed to update campaign' });
  }
});

// POST /api/v1/campaigns/:id/start - Start campaign
router.post('/:id/start', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      where: { id: req.params.id, organizationId: req.user.org },
    });
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    if (campaign.status !== 'draft') {
      return res.status(400).json({ error: `Cannot start campaign in status: ${campaign.status}` });
    }
    
    campaign.status = 'active';
    campaign.startedAt = new Date();
    await campaign.save();
    realtime.emitCampaignUpdated(campaign, req.headers['x-client-id']);
    
    res.json({ success: true, data: campaign });
  } catch (error) {
    console.error('Start campaign error:', error);
    res.status(500).json({ error: 'Failed to start campaign' });
  }
});

// POST /api/v1/campaigns/:id/pause - Pause campaign
router.post('/:id/pause', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      where: { id: req.params.id, organizationId: req.user.org },
    });
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    if (campaign.status !== 'active') {
      return res.status(400).json({ error: `Cannot pause campaign in status: ${campaign.status}` });
    }
    
    campaign.status = 'paused';
    campaign.pausedAt = new Date();
    await campaign.save();
    realtime.emitCampaignUpdated(campaign, req.headers['x-client-id']);
    
    res.json({ success: true, data: campaign });
  } catch (error) {
    console.error('Pause campaign error:', error);
    res.status(500).json({ error: 'Failed to pause campaign' });
  }
});

// POST /api/v1/campaigns/:id/cancel - Cancel campaign (history + analytics preserved)
const CANCELLABLE = ['draft', 'ready_for_review', 'scheduled', 'active', 'running', 'paused', 'failed'];
router.post('/:id/cancel', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      where: { id: req.params.id, organizationId: req.user.org },
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (!CANCELLABLE.includes(campaign.status)) {
      return res.status(400).json({ error: `Cannot cancel campaign in status: ${campaign.status}` });
    }

    campaign.status = 'cancelled';
    campaign.cancelledAt = new Date();
    await campaign.save();
    realtime.emitCampaignUpdated(campaign, req.headers['x-client-id']);

    // Cancel all queued jobs — no further sends.
    await models.EmailJob.update(
      { status: 'cancelled' },
      { where: { campaignId: campaign.id, status: 'queued' } }
    );

    res.json({ success: true, data: campaign });
  } catch (error) {
    console.error('Cancel campaign error:', error);
    res.status(500).json({ error: 'Failed to cancel campaign' });
  }
});

// POST /api/v1/campaigns/:id/duplicate - Duplicate campaign
router.post('/:id/duplicate', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const original = await Campaign.findOne({
      where: { id: req.params.id, organizationId: req.user.org },
      include: [{ model: models.CampaignSequence, as: 'sequel' }],
    });
    
    if (!original) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    
    const duplicate = await Campaign.create({
      organizationId: req.user.org,
      createdBy: req.user.id,
      name: `${original.name} (Copy)`,
      description: original.description,
      campaignType: original.campaignType,
      maxEmailsPerDay: original.maxEmailsPerDay,
      maxEmailsPerLead: original.maxEmailsPerLead,
      sendBetweenStartHour: original.sendBetweenStartHour,
      sendBetweenEndHour: original.sendBetweenEndHour,
      sendDaysOfWeek: original.sendDaysOfWeek,
      timezone: original.timezone,
      aiProvider: original.aiProvider,
      aiPersonalizationEnabled: original.aiPersonalizationEnabled,
      aiApprovalRequired: original.aiApprovalRequired,
      status: 'draft',
    });
    
    // Duplicate sequences and steps would go here
    
    res.status(201).json({
      success: true,
      data: duplicate,
    });
  } catch (error) {
    console.error('Duplicate campaign error:', error);
    res.status(500).json({ error: 'Failed to duplicate campaign' });
  }
});

// GET /api/v1/campaigns/:id/analytics - Campaign analytics (event-based, authoritative)
router.get('/:id/analytics', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await Campaign.findOne({
      where: { id: req.params.id, organizationId: req.user.org },
    });

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Authoritative counts from the append-only event log.
    const events = await models.EmailEvent.findAll({
      where: { campaignId: campaign.id },
      attributes: ['eventType', 'metadata', 'sendingAccountId'],
    });

    let queued = 0, sent = 0, failed = 0, bounced = 0, softFailed = 0, unsubscribed = 0, replied = 0;
    for (const ev of events) {
      switch (ev.eventType) {
        case 'QUEUED': queued++; break;
        case 'SENT': sent++; break;
        case 'UNSUBSCRIBED': unsubscribed++; break;
        case 'REPLIED': replied++; break;
        case 'FAILED': {
          failed++;
          const klass = ev.metadata?.failureClass;
          if (['permanent', 'auth', 'dns', 'PERMANENT_FAILURE', 'AUTHENTICATION_ERROR', 'MAILBOX_UNAVAILABLE'].includes(klass)) bounced++;
          else softFailed++;
          break;
        }
        default: break;
      }
    }

    const totalRecipients = await models.CampaignLead.count({ where: { campaignId: campaign.id } });
    const activeRecipients = await models.CampaignLead.count({
      where: { campaignId: campaign.id, status: { [Op.notIn]: ['unsubscribed', 'bounced', 'suppressed'] } },
    });

    // PROMPT 9.1 §44 — per sending-account breakdown, from real event data.
    const byAccount = {};
    for (const ev of events) {
      const acctId = ev.sendingAccountId || (ev.metadata && ev.metadata.sendingAccountId) || null;
      if (!acctId) continue;
      if (!byAccount[acctId]) byAccount[acctId] = { accountId: acctId, sent: 0, replied: 0, bounced: 0, failed: 0 };
      if (ev.eventType === 'SENT') byAccount[acctId].sent++;
      else if (ev.eventType === 'REPLIED') byAccount[acctId].replied++;
      else if (ev.eventType === 'FAILED') {
        const klass = ev.metadata?.failureClass;
        if (['permanent', 'PERMANENT_FAILURE', 'AUTHENTICATION_ERROR', 'MAILBOX_UNAVAILABLE'].includes(klass)) byAccount[acctId].bounced++;
        else byAccount[acctId].failed++;
      }
    }
    const accountIds = Object.keys(byAccount);
    let accountBreakdown = [];
    if (accountIds.length) {
      const acctRows = await models.SmtpAccount.findAll({
        where: { id: accountIds, organizationId: campaign.organizationId },
        attributes: ['id', 'fromEmail', 'fromName'],
      });
      const acctMap = new Map(acctRows.map((a) => [a.id, a]));
      accountBreakdown = accountIds.map((id) => ({
        accountId: id,
        email: acctMap.get(id)?.fromEmail || 'unknown',
        fromName: acctMap.get(id)?.fromName || null,
        sent: byAccount[id].sent,
        replied: byAccount[id].replied,
        bounced: byAccount[id].bounced,
        failed: byAccount[id].failed,
      }));
    }

    // With self-hosted SMTP, "delivered" = accepted by the recipient mail server
    // (SENT) minus synchronously-detected hard bounces.
    const delivered = Math.max(0, sent - bounced);

    const rate = (num, den) => (den > 0 ? Math.round((num / den) * 10000) / 100 : 0);

    res.json({
      success: true,
      data: {
        campaignId: campaign.id,
        status: campaign.status,
        totalRecipients,
        activeRecipients,
        queued,
        sent,
        delivered,
        bounced,
        softFailed,
        failed,
        replied,
        unsubscribed,
        replyRate: rate(replied, sent),
        bounceRate: rate(bounced, sent),
        unsubscribeRate: rate(unsubscribed, sent),
        failureRate: rate(failed, sent),
        accounts: accountBreakdown,
      },
    });
  } catch (error) {
    console.error('Campaign analytics error:', error);
    res.status(500).json({ error: 'Failed to get campaign analytics' });
  }
});

// ============================================================================
// Sequence Routes
// ============================================================================

// POST /api/v1/campaigns/:campaignId/sequences - Create sequence
router.post('/:campaignId/sequences', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const { name, description, steps } = req.body;
    
    const sequence = await models.CampaignSequence.create({
      campaignId: req.params.campaignId,
      organizationId: req.user.org,
      name,
      description,
    });
    
    // If steps provided, create them
    if (steps && Array.isArray(steps)) {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const created = await models.CampaignStep.create({
          sequenceId: sequence.id,
          stepOrder: i,
          name: step.name,
          subjectTemplate: step.subjectTemplate,
          bodyTemplate: step.bodyTemplate,
          delayDays: step.delayDays || 0,
          delayHours: step.delayHours || 0,
          delayMinutes: step.delayMinutes || 0,
          signatureMode: ['inherit', 'custom', 'none'].includes(String(step.signatureMode || 'inherit').toLowerCase())
            ? String(step.signatureMode).toLowerCase() : 'inherit',
          signatureId: step.signatureId || null,
        });
        // A/B variants (§9-10) — same contract as the PUT editor.
        if (Array.isArray(step.variants) && step.variants.length) {
          const weightTotal = step.variants.reduce((sum, v) => sum + (parseInt(v.weight, 10) || 0), 0);
          if (weightTotal !== 100) {
            return res.status(422).json({ error: `Variant distribution for step ${i + 1} must total 100% (got ${weightTotal}%).` });
          }
          for (let vi = 0; vi < step.variants.length; vi++) {
            const v = step.variants[vi];
            await models.CampaignStepVariant.create({
              stepId: created.id,
              organizationId: req.user.org,
              variantName: v.variantName || `Variant ${String.fromCharCode(65 + vi)}`,
              variantOrder: vi,
              subject: v.subject || '',
              bodyHtml: v.bodyHtml || v.body || '',
              bodyText: v.bodyText || '',
              weight: parseInt(v.weight, 10) || 0,
            });
          }
        }
      }
    }
    
    // Return the full sequence (steps + variants) so the draft editor can
    // immediately address server-assigned ids (preview, test email).
    const fresh = await models.CampaignSequence.findByPk(sequence.id, {
      include: [
        { model: models.CampaignStep, as: 'steps', include: [{ model: models.CampaignStepVariant, as: 'variants' }] },
      ],
      distinct: true,
      order: [
        [{ model: models.CampaignStep, as: 'steps' }, 'stepOrder', 'ASC'],
        [{ model: models.CampaignStep, as: 'steps' }, { model: models.CampaignStepVariant, as: 'variants' }, 'variantOrder', 'ASC'],
      ],
    });
    realtime.emitSequenceSaved(req.params.campaignId, req.user.org, fresh.id, req.headers['x-client-id']);
    res.status(201).json({
      success: true,
      data: fresh,
    });
  } catch (error) {
    console.error('Create sequence error:', error);
    res.status(500).json({ error: 'Failed to create sequence' });
  }
});

// GET /api/v1/campaigns/:campaignId/sequences - List sequences
router.get('/:campaignId/sequences', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const sequences = await models.CampaignSequence.findAll({
      where: { campaignId: req.params.campaignId, organizationId: req.user.org },
      include: [{
        model: models.CampaignStep, as: 'steps',
        include: [{ model: models.CampaignStepVariant, as: 'variants' }],
      }],
      order: [
        ['createdAt', 'ASC'],
        [{ model: models.CampaignStep, as: 'steps' }, 'stepOrder', 'ASC'],
        [{ model: models.CampaignStep, as: 'steps' }, { model: models.CampaignStepVariant, as: 'variants' }, 'variantOrder', 'ASC'],
      ],
      distinct: true,
    });

    res.json({ success: true, data: sequences });
  } catch (error) {
    console.error('List sequences error:', error);
    res.status(500).json({ error: 'Failed to list sequences' });
  }
});

// PUT /api/v1/campaigns/:campaignId/sequences/:sequenceId - Replace a sequence's
// steps (draft-time editor). Old steps are deleted and recreated in one
// transaction, so the engine never sees duplicate or orphaned steps.
router.put('/:campaignId/sequences/:sequenceId', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const sequence = await models.CampaignSequence.findOne({
      where: { id: req.params.sequenceId, campaignId: req.params.campaignId, organizationId: req.user.org },
    });
    if (!sequence) return res.status(404).json({ error: 'Sequence not found' });

    const campaign = await Campaign.findOne({
      where: { id: req.params.campaignId, organizationId: req.user.org },
    });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (!['draft', 'ready_for_review', 'paused'].includes(campaign.status)) {
      return res.status(400).json({ error: `Sequence can only be edited while the campaign is editable (current: ${campaign.status})` });
    }

    const { name, description, steps } = req.body || {};
    await sequelize.transaction(async (t) => {
      if (name !== undefined) sequence.name = name;
      if (description !== undefined) sequence.description = description;
      await sequence.save({ transaction: t });

      // FK-safe ordering: create the replacement steps FIRST (new ids), repoint
      // every reference away from the old steps, then retire them — deleting
      // first would violate email_jobs.step_id (no cascade on SQLite).
      const oldSteps = await models.CampaignStep.findAll({
        where: { sequenceId: sequence.id },
        attributes: ['id', 'stepOrder'],
        transaction: t,
      });
      const oldStepIdByOrder = new Map(oldSteps.map((s) => [s.stepOrder, s.id]));
      const oldStepIds = oldSteps.map((s) => s.id);

      const newStepIdByOrder = new Map();
      if (Array.isArray(steps)) {
        for (let i = 0; i < steps.length; i++) {
          const s = steps[i];
          const step = await models.CampaignStep.create({
            sequenceId: sequence.id,
            stepOrder: i,
            name: s.name || `Email ${i + 1}`,
            subjectTemplate: s.subjectTemplate || '',
            bodyTemplate: s.bodyTemplate || '',
            delayDays: s.delayDays || 0,
            delayHours: s.delayHours || 0,
            delayMinutes: s.delayMinutes || 0,
            signatureMode: ['inherit', 'custom', 'none'].includes(String(s.signatureMode || 'inherit').toLowerCase())
              ? String(s.signatureMode).toLowerCase() : 'inherit',
            signatureId: s.signatureId || null,
          }, { transaction: t });
          newStepIdByOrder.set(i, step.id);

          // A/B variants (§9-10). Weights are validated to total 100 per step.
          if (Array.isArray(s.variants) && s.variants.length) {
            const weightTotal = s.variants.reduce((sum, v) => sum + (parseInt(v.weight, 10) || 0), 0);
            if (weightTotal !== 100) {
              const err = new Error(`Variant distribution for step ${i + 1} must total 100% (got ${weightTotal}%).`);
              err.statusCode = 422;
              throw err;
            }
            for (let vi = 0; vi < s.variants.length; vi++) {
              const v = s.variants[vi];
              await models.CampaignStepVariant.create({
                stepId: step.id,
                organizationId: req.user.org,
                variantName: v.variantName || `Variant ${String.fromCharCode(65 + vi)}`,
                variantOrder: vi,
                subject: v.subject || '',
                bodyHtml: v.bodyHtml || v.body || '',
                bodyText: v.bodyText || '',
                weight: parseInt(v.weight, 10) || 0,
              }, { transaction: t });
            }
          }
        }
      }
      // Steps are recreated on every save (new ids). Repoint enrolled
      // recipients AND queued jobs at the replacement step with the same
      // position — email_jobs.step_id is a real FK (no cascade on SQLite) and
      // campaign_leads.current_step_id is a plain UUID; both must not dangle.
      if (oldSteps.length) {
        const remap = [];
        for (const [order, newId] of newStepIdByOrder) {
          const oldId = oldStepIdByOrder.get(order);
          if (oldId && oldId !== newId) remap.push([oldId, newId]);
        }
        for (const [oldId, newId] of remap) {
          await models.CampaignLead.update(
            { currentStepId: newId },
            { where: { campaignId: req.params.campaignId, currentStepId: oldId }, transaction: t },
          );
          await models.EmailJob.update(
            { stepId: newId },
            { where: { campaignId: req.params.campaignId, stepId: oldId }, transaction: t },
          );
        }
      }
      // References now point at the replacements — retire the old rows.
      if (oldStepIds.length) {
        await models.CampaignStepVariant.destroy({ where: { stepId: oldStepIds }, transaction: t });
        await models.CampaignStep.destroy({ where: { id: oldStepIds }, transaction: t });
      }
    });

    const fresh = await models.CampaignSequence.findByPk(sequence.id, {
      include: [
        { model: models.CampaignStep, as: 'steps', include: [{ model: models.CampaignStepVariant, as: 'variants' }] },
      ],
      distinct: true,
      order: [
        [{ model: models.CampaignStep, as: 'steps' }, 'stepOrder', 'ASC'],
        [{ model: models.CampaignStep, as: 'steps' }, { model: models.CampaignStepVariant, as: 'variants' }, 'variantOrder', 'ASC'],
      ],
    });
    realtime.emitSequenceSaved(req.params.campaignId, req.user.org, fresh.id, req.headers['x-client-id']);
    res.json({ success: true, data: fresh });
  } catch (error) {
    console.error('Replace sequence error:', error);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Failed to update sequence' });
  }
});

// DELETE /api/v1/campaigns/:campaignId/sequences/:sequenceId
router.delete('/:campaignId/sequences/:sequenceId', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const sequence = await models.CampaignSequence.findOne({
      where: { id: req.params.sequenceId, campaignId: req.params.campaignId, organizationId: req.user.org },
    });
    if (!sequence) return res.status(404).json({ error: 'Sequence not found' });
    // Variants have no cascade on every dialect — clear children explicitly.
    const steps = await models.CampaignStep.findAll({ where: { sequenceId: sequence.id }, attributes: ['id'] });
    if (steps.length) {
      await models.CampaignStepVariant.destroy({ where: { stepId: steps.map((s) => s.id) } });
    }
    await sequence.destroy(); // steps cascade
    res.json({ success: true, data: { id: sequence.id } });
  } catch (error) {
    console.error('Delete sequence error:', error);
    res.status(500).json({ error: 'Failed to delete sequence' });
  }
});

// ============================================================================
// Sequence Builder: preview, test email, validation (§33-35, §39-41)
// ============================================================================

// Load a campaign's ordered steps WITH their variants (tenant-checked).
async function loadStepsWithVariants(campaignId) {
  const sequences = await models.CampaignSequence.findAll({
    where: { campaignId },
    attributes: ['id'],
    order: [['createdAt', 'ASC']],
  });
  if (!sequences.length) return [];
  return models.CampaignStep.findAll({
    where: { sequenceId: sequences.map((s) => s.id) },
    include: [{ model: models.CampaignStepVariant, as: 'variants' }],
    order: [['stepOrder', 'ASC'], ['createdAt', 'ASC']],
  });
}

// The variable universe a template may reference: lead fields (snake + camel),
// the org's imported custom-variable slugs, account + platform variables.
const { knownVariablesForOrg } = require('../services/known-vars');

// §8 — the previous step's first-variant subject (thread continuation).
async function previousStepSubject(step) {
  const prevStep = await models.CampaignStep.findOne({
    where: { sequenceId: step.sequenceId, stepOrder: { [Op.lt]: step.stepOrder } },
    order: [['stepOrder', 'DESC']],
  });
  if (!prevStep) return null;
  const prevVariant = await models.CampaignStepVariant.findOne({
    where: { stepId: prevStep.id }, order: [['variantOrder', 'ASC']],
  });
  return (prevVariant && prevVariant.subject) || prevStep.subjectTemplate || null;
}

function sampleRecipient() {
  // Clearly-labeled sample used only when the campaign has no recipients yet —
  // the preview panel marks it as sample data.
  return {
    id: 'sample', email: 'john@example.com', firstName: 'John', lastName: 'Doe',
    companyName: 'Acme Technologies', jobTitle: 'CTO', leadId: null, isSample: true,
  };
}

// Verify a step belongs to this campaign (tenant chain: step → sequence → campaign).
async function loadStepForCampaign(req, stepId) {
  return models.CampaignStep.findOne({
    where: { id: stepId },
    include: [{
      model: models.CampaignSequence, as: 'sequence',
      where: { campaignId: req.params.campaignId, organizationId: req.user.org },
      required: true,
    }],
  });
}

// POST /api/v1/campaigns/:campaignId/preview — render a step/variant fully
// resolved against a REAL recipient + sending account (§33-34, §53-55).
// Rendering is shared with the realtime socket handler (services/preview-renderer).
const { renderForPreview } = require('../services/preview-renderer');
router.post('/:campaignId/preview', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ where: { id: req.params.campaignId, organizationId: req.user.org } });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const { stepId, variantId, recipientId, sendingAccountId, spintaxSeed } = req.body || {};
    const { status, body } = await renderForPreview(campaign, req.user.org, { stepId, variantId, recipientId, sendingAccountId, spintaxSeed });
    res.status(status).json(body);
  } catch (error) {
    console.error('Sequence preview error:', error);
    res.status(500).json({ error: 'Failed to render preview' });
  }
});

// POST /api/v1/campaigns/:campaignId/test-email — REAL SMTP send (§35).
// Renders the selected step/variant with real recipient data and sends it
// through the configured sending account. No simulation anywhere.
router.post('/:campaignId/test-email', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ where: { id: req.params.campaignId, organizationId: req.user.org } });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const { stepId, variantId, recipients, sendingAccountId } = req.body || {};
    const to = Array.isArray(recipients) ? recipients.map((r) => String(r).trim()).filter(Boolean).slice(0, 5) : [];
    if (!to.length) return res.status(422).json({ error: 'At least one test recipient is required' });
    if (to.some((r) => !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r))) {
      return res.status(422).json({ error: 'One or more test recipient emails are invalid' });
    }
    if (!stepId) return res.status(422).json({ error: 'stepId is required' });

    const step = await loadStepForCampaign(req, stepId);
    if (!step) return res.status(404).json({ error: 'Sequence step not found' });
    const variants = await models.CampaignStepVariant.findAll({ where: { stepId: step.id }, order: [['variantOrder', 'ASC']] });

    const accountId = sendingAccountId || campaign.sendingAccountId;
    if (!accountId) return res.status(422).json({ error: 'No sending account selected for this campaign' });
    const account = await models.SmtpAccount.findOne({ where: { id: accountId, organizationId: req.user.org } });
    if (!account) return res.status(404).json({ error: 'Sending account not found' });
    if (!account.isEnabled) return res.status(422).json({ error: 'Sending account is disabled' });

    const recipient = await models.CampaignLead.findOne({ where: { campaignId: campaign.id }, order: [['createdAt', 'ASC']] }) || sampleRecipient();
    const lead = recipient.leadId ? await models.Lead.findByPk(recipient.leadId) : null;
    const unsubscribeUrl = `${process.env.APP_BASE_URL || 'http://localhost:8000'}/api/v1/unsubscribe/${require('../services/crypto').signUnsubscribeToken({
      organizationId: campaign.organizationId, campaignId: campaign.id, recipientId: recipient.id || 'test', email: recipient.email,
    })}`;
    const vars = engine.buildLeadVars(recipient, lead, account, unsubscribeUrl);
    const prevSubject = await previousStepSubject(step);
    const seed = `test-email:${recipient.email}`;
    let rendered = engine.renderForRecipient({ step, variants, vars, seed, prevSubject });
    if (variantId) {
      // A specific variant was requested — re-render with it forced.
      const chosen = variants.find((v) => v.id === variantId);
      if (!chosen) return res.status(404).json({ error: 'Variant not found' });
      rendered = templateRenderer.renderEmail({
        subject: chosen.subject || prevSubject || '',
        bodyHtml: chosen.bodyHtml || chosen.bodyText || step.bodyTemplate,
        vars, seed, prevSubject,
      });
    }

    const result = await emailService.sendEmail(account, {
      to,
      subject: `[TEST] ${rendered.subject || '(no subject)'}`,
      html: `${rendered.html}<div style="margin-top:24px;padding-top:12px;border-top:1px solid #eee;font-size:12px;color:#888"><a href="${unsubscribeUrl}">Unsubscribe</a></div>`,
      text: rendered.text,
      headers: { 'X-Campaign-Id': campaign.id, 'X-Test-Email': 'true' },
    });

    if (!result.ok) {
      // Honest failure — the SMTP error class, no pretending it sent.
      return res.status(502).json({ error: `Test email could not be sent: ${result.error || 'SMTP failure'}`, failureClass: result.failureClass || null });
    }
    res.json({ success: true, data: { sent: true, messageId: result.messageId, to } });
  } catch (error) {
    console.error('Test email error:', error);
    res.status(500).json({ error: 'Failed to send test email' });
  }
});

// GET /api/v1/campaigns/:campaignId/validate — structured sequence validation
// (§39-§41): undefined variables, malformed spintax/conditionals, variant
// distribution. Returned as machine-readable `issues` for click-to-field UX.
router.get('/:campaignId/validate', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ where: { id: req.params.campaignId, organizationId: req.user.org } });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    const issues = await validateSequenceContent(campaign);
    const knownVariables = await knownVariablesForOrg(campaign.organizationId);
    res.json({ success: true, data: { issues, ready: issues.length === 0, knownVariables: [...knownVariables] } });
  } catch (error) {
    console.error('Sequence validate error:', error);
    res.status(500).json({ error: 'Failed to validate sequence' });
  }
});

// Shared with launch validation: content-level checks with codes.
async function validateSequenceContent(campaign) {
  const issues = [];
  const steps = await loadStepsWithVariants(campaign.id);
  if (!steps.length) {
    issues.push({ code: 'no_steps', message: 'Sequence has no emails. Add at least one email step.', field: 'steps' });
    return issues;
  }
  const known = await knownVariablesForOrg(campaign.organizationId);
  const stepNumber = (i) => `Step ${i + 1}`;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const contents = (step.variants && step.variants.length)
      ? step.variants.map((v) => ({ id: v.id, subject: v.subject, body: v.bodyHtml || v.bodyText, name: v.variantName, fieldBase: 'variant' }))
      : [{ id: null, subject: step.subjectTemplate, body: step.bodyTemplate, name: step.name, fieldBase: 'step' }];

    // Variant distribution must total 100% (§10).
    if (step.variants && step.variants.length) {
      const total = step.variants.reduce((s, v) => s + (v.weight || 0), 0);
      if (total !== 100) {
        issues.push({
          code: 'variant_distribution', stepId: step.id, field: 'variants',
          message: `${stepNumber(i)} variant distribution totals ${total}% — must be exactly 100%.`,
        });
      }
      // Every variant needs a body; subject may be empty only on steps > 0 (§8).
      for (const v of step.variants) {
        if (!v.bodyHtml && !v.bodyText) {
          issues.push({ code: 'empty_body', stepId: step.id, variantId: v.id, field: 'body', message: `${stepNumber(i)} (${v.variantName}) has an empty email body.` });
        }
        if (i === 0 && !v.subject) {
          issues.push({ code: 'empty_subject', stepId: step.id, variantId: v.id, field: 'subject', message: `${stepNumber(i)} (${v.variantName}) needs a subject — the first email cannot continue a thread.` });
        }
      }
    } else if (!step.bodyTemplate) {
      issues.push({ code: 'empty_body', stepId: step.id, field: 'body', message: `${stepNumber(i)} has an empty email body.` });
    } else if (i === 0 && !step.subjectTemplate) {
      issues.push({ code: 'empty_subject', stepId: step.id, field: 'subject', message: `${stepNumber(i)} needs a subject — the first email cannot continue a thread.` });
    }

    for (const c of contents) {
      const analyze = (text, field) => {
        const a = templateRenderer.analyze(text, known);
        for (const v of a.undefinedVars) {
          issues.push({
            code: 'undefined_variable', stepId: step.id, variantId: c.id, field,
            variable: v, message: `${stepNumber(i)}${c.name ? ` (${c.name})` : ''} contains an undefined variable {{${v}}}.`,
          });
        }
        for (const bad of a.malformedSpintax) {
          issues.push({ code: 'malformed_spintax', stepId: step.id, variantId: c.id, field, message: `${stepNumber(i)}${c.name ? ` (${c.name})` : ''} has malformed Spintax — ${bad.reason}` });
        }
        for (const bad of a.malformedConditionals) {
          issues.push({ code: 'malformed_conditional', stepId: step.id, variantId: c.id, field, message: `${stepNumber(i)}${c.name ? ` (${c.name})` : ''} has a malformed conditional — ${bad.reason}` });
        }
      };
      analyze(c.subject, 'subject');
      analyze(c.body, 'body');
    }
  }
  return issues;
}

// ============================================================================
// Lead Routes within Campaign
// ============================================================================

// POST /api/v1/campaigns/:campaignId/leads - Add lead to campaign
router.post('/:campaignId/leads', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const { leadId } = req.body;

    if (!leadId) {
      return res.status(422).json({ error: 'leadId is required' });
    }

    const campaign = await Campaign.findOne({
      where: { id: req.params.campaignId, organizationId: req.user.org },
    });
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const existing = await models.CampaignLead.findOne({
      where: { campaignId: campaign.id, leadId },
    });
    if (existing) {
      return res.status(409).json({ error: 'Lead is already enrolled in this campaign' });
    }

    const lead = await models.CampaignLead.create({
      campaignId: campaign.id,
      leadId,
      status: 'pending',
    });

    res.status(201).json({ success: true, data: lead });
  } catch (error) {
    console.error('Add lead to campaign error:', error);
    res.status(500).json({ error: 'Failed to add lead to campaign' });
  }
});

// GET /api/v1/campaigns/:campaignId/leads - List campaign leads
router.get('/:campaignId/leads', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const { status } = req.query;
    
    const where = { campaignId: req.params.campaignId };
    if (status) where.status = status;
    
    const leads = await models.CampaignLead.findAll({ where });
    
    res.json({ success: true, data: leads });
  } catch (error) {
    console.error('List campaign leads error:', error);
    res.status(500).json({ error: 'Failed to list campaign leads' });
  }
});

// ============================================================================
// Sending Account Routes
// ============================================================================

// PROMPT 9.1 — campaign sending-account pool endpoints live in
// routes/campaign-accounts.js (mounted at /api/v1/campaigns). The legacy
// plaintext-credential endpoints that used to live here were removed.

// ============================================================================
// Email Template Routes
// ============================================================================

// POST /api/v1/campaigns/:campaignId/templates - Create email template
router.post('/:campaignId/templates', authenticate, checkOrgMembership, async (req, res) => {
  try {
    // Model fields: name, subject, body, variables, isActive
    const { name, subject, body, variables } = req.body;

    if (!name || !subject || !body) {
      return res.status(422).json({ error: 'name, subject and body are required' });
    }

    const template = await models.CampaignEmailTemplate.create({
      campaignId: req.params.campaignId,
      organizationId: req.user.org,
      name,
      subject,
      body,
      variables: Array.isArray(variables) ? variables : [],
      isActive: true,
    });
    
    res.status(201).json({
      success: true,
      data: template,
    });
  } catch (error) {
    console.error('Create template error:', error);
    res.status(500).json({ error: 'Failed to create email template' });
  }
});

// GET /api/v1/campaigns/:campaignId/templates - List templates
router.get('/:campaignId/templates', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const templates = await models.CampaignEmailTemplate.findAll({
      where: { campaignId: req.params.campaignId, organizationId: req.user.org },
    });
    
    res.json({ success: true, data: templates });
  } catch (error) {
    console.error('List templates error:', error);
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

// ============================================================================
// AI Proposal Routes
// ============================================================================

// POST /api/v1/campaigns/:campaignId/ai-proposals - Save an AI proposal for review
// Note: AI text generation runs backend-side via the configured provider
// (Ollama/Groq/OpenRouter/Gemini). This endpoint persists the proposal for
// the approval workflow; no placeholder content is invented here.
router.post('/:campaignId/ai-proposals', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const { leadId, stepId, proposedSubject, proposedBody, aiProvider, aiModel } = req.body || {};

    if (!proposedSubject && !proposedBody) {
      return res.status(422).json({
        error: 'proposedSubject or proposedBody is required (generated by the AI provider)',
      });
    }

    const campaign = await Campaign.findOne({
      where: { id: req.params.campaignId, organizationId: req.user.org },
    });
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const proposal = await models.CampaignAIProposal.create({
      campaignId: campaign.id,
      leadId: leadId || null,
      stepId: stepId || null,
      proposedSubject: proposedSubject || null,
      proposedBody: proposedBody || null,
      aiProvider: aiProvider || null,
      aiModel: aiModel || null,
      status: 'pending',
    });
    
    res.status(201).json({
      success: true,
      data: proposal,
    });
  } catch (error) {
    console.error('Generate AI proposal error:', error);
    res.status(500).json({ error: 'Failed to generate AI proposal' });
  }
});

// GET /api/v1/campaigns/:campaignId/ai-proposals - List AI proposals
router.get('/:campaignId/ai-proposals', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const { status } = req.query;
    
    const where = { campaignId: req.params.campaignId };
    if (status) where.status = status;
    
    const proposals = await models.CampaignAIProposal.findAll({ where });
    
    res.json({ success: true, data: proposals });
  } catch (error) {
    console.error('List AI proposals error:', error);
    res.status(500).json({ error: 'Failed to list AI proposals' });
  }
});

// POST /api/v1/campaigns/:campaignId/ai-proposals/:proposalId/approve - Approve/reject proposal
router.post('/:campaignId/ai-proposals/:proposalId/approve', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const { action, reason, modifiedSubject, modifiedBody } = req.body;
    
    const proposal = await models.CampaignAIProposal.findOne({
      where: { id: req.params.proposalId, campaignId: req.params.campaignId },
    });
    
    if (!proposal) {
      return res.status(404).json({ error: 'Proposal not found' });
    }
    
    proposal.status = action;
    if (action === 'approved') {
      proposal.approvedAt = new Date();
    }
    if (reason) proposal.rejectionReason = reason;
    if (modifiedSubject) proposal.proposedSubject = modifiedSubject;
    if (modifiedBody) proposal.proposedBody = modifiedBody;
    await proposal.save();
    
    res.json({ success: true, data: proposal });
  } catch (error) {
    console.error('Approve proposal error:', error);
    res.status(500).json({ error: 'Failed to approve proposal' });
  }
});

// ============================================================================
// PROMPT 6 - Campaign & Outreach Engine: lifecycle, recipients, events,
// preview, personalization. All state transitions enforced server-side.
// ============================================================================

const aiService = require('../services/ai');
const { signUnsubscribeToken } = require('../services/crypto');

// Load a campaign scoped to the caller's org; 404s when missing/foreign.
async function loadCampaign(req, res) {
  const campaign = await Campaign.findOne({
    where: { id: req.params.id, organizationId: req.user.org },
  });
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return null;
  }
  return campaign;
}

// Valid lifecycle transitions (Prompt 6 §20). 'running' is treated as a
// synonym of 'active' for compatibility with earlier prompt-5 rows.
const TRANSITIONS = {
  draft: ['ready_for_review', 'scheduled', 'active', 'cancelled', 'archived'],
  ready_for_review: ['scheduled', 'active', 'draft', 'cancelled', 'archived'],
  scheduled: ['active', 'ready_for_review', 'cancelled', 'archived'],
  active: ['paused', 'completed', 'cancelled', 'archived'],
  running: ['paused', 'completed', 'cancelled', 'archived'],
  paused: ['active', 'cancelled', 'archived'],
  completed: ['archived'],
  cancelled: ['archived'],
  failed: ['active', 'archived'],
  archived: [],
};

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

function normalizeStatus(status) {
  return status === 'running' ? 'active' : status;
}

// Collect the campaign's ordered sequence steps (across its sequences).
async function getOrderedSteps(campaignId, transaction) {
  const sequences = await models.CampaignSequence.findAll({
    where: { campaignId },
    attributes: ['id'],
    order: [['createdAt', 'ASC']],
    transaction,
  });
  const ids = sequences.map((s) => s.id);
  if (!ids.length) return [];
  return models.CampaignStep.findAll({
    where: { sequenceId: ids },
    order: [['stepOrder', 'ASC'], ['createdAt', 'ASC']],
    transaction,
  });
}

// Shared content gate (§8, §39-§41, §19): used by launch AND resume — a
// campaign may not enter/re-enter the sending state with an empty email body
// or a first email whose subject is missing. Returns { problems, issues } and
// never mutates.
async function campaignContentProblems(campaign) {
  const problems = [];
  const steps = await getOrderedSteps(campaign.id);
  if (!steps.length) problems.push('Sequence has no emails.');
  // Content lives either on the step itself or in its A/B variants (§9).
  // Every email needs a body; the first email must also carry a subject (§8).
  let variantBodies = [];
  if (steps.length) {
    variantBodies = await models.CampaignStepVariant.findAll({
      where: { stepId: steps.map((s) => s.id) },
    });
  }
  const stepHasContent = (s) => {
    const vs = variantBodies.filter((v) => v.stepId === s.id);
    if (vs.length) {
      return vs.every((v) => (v.bodyHtml || v.bodyText) && (s.stepOrder !== 0 || v.subject));
    }
    return Boolean(s.bodyTemplate) && (s.stepOrder !== 0 || Boolean(s.subjectTemplate));
  };
  if (steps.length && !steps.every(stepHasContent)) {
    problems.push('Every sequence email needs a body (and the first email a subject).');
  }

  // Sequence Builder content validation (§39-§41): undefined variables,
  // malformed spintax/conditionals, variant distribution, empty bodies.
  const issues = await validateSequenceContent(campaign);
  for (const issue of issues) problems.push(issue.message);
  return { problems, issues };
}

// ----------------------------------------------------------------------------
// Lifecycle: review → schedule → launch → pause/resume → archive

// POST /api/v1/campaigns/:id/review - mark ready for human review
router.post('/:id/review', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    if (!canTransition(normalizeStatus(campaign.status), 'ready_for_review')) {
      return res.status(400).json({ error: `Cannot move campaign from ${campaign.status} to ready_for_review` });
    }
    const steps = await getOrderedSteps(campaign.id);
    if (!steps.length) {
      return res.status(422).json({ error: 'Add at least one sequence email before requesting review' });
    }
    campaign.status = 'ready_for_review';
    await campaign.save();
    realtime.emitCampaignUpdated(campaign, req.headers['x-client-id']);
    res.json({ success: true, data: campaign });
  } catch (error) {
    console.error('Review campaign error:', error);
    res.status(500).json({ error: 'Failed to mark campaign ready for review' });
  }
});

// POST /api/v1/campaigns/:id/schedule - schedule the campaign
router.post('/:id/schedule', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    if (!canTransition(normalizeStatus(campaign.status), 'scheduled')) {
      return res.status(400).json({ error: `Cannot schedule campaign from status: ${campaign.status}` });
    }
    const startAt = req.body?.scheduledStartAt ? new Date(req.body.scheduledStartAt) : campaign.scheduledStartAt;
    if (!startAt || Number.isNaN(startAt.getTime())) {
      return res.status(422).json({ error: 'A valid start date/time is required to schedule a campaign' });
    }
    const steps = await getOrderedSteps(campaign.id);
    if (!steps.length) {
      return res.status(422).json({ error: 'Add at least one sequence email before scheduling' });
    }
    const recipientCount = await models.CampaignLead.count({ where: { campaignId: campaign.id } });
    if (!recipientCount) {
      return res.status(422).json({ error: 'Add at least one recipient before scheduling' });
    }
    campaign.scheduledStartAt = startAt;
    campaign.status = 'scheduled';
    await campaign.save();
    realtime.emitCampaignUpdated(campaign, req.headers['x-client-id']);
    res.json({ success: true, data: campaign });
  } catch (error) {
    console.error('Schedule campaign error:', error);
    res.status(500).json({ error: 'Failed to schedule campaign' });
  }
});

// POST /api/v1/campaigns/:id/launch - validate everything, queue jobs, go active.
// All validation is backend-side (Prompt 6 §19); the frontend cannot bypass it.
router.post('/:id/launch', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    const from = normalizeStatus(campaign.status);
    if (!canTransition(from, 'active')) {
      return res.status(400).json({ error: `Cannot launch campaign from status: ${campaign.status}` });
    }

    // --- validation ---------------------------------------------------------
    const problems = [];
    const { problems: contentProblems, issues } = await campaignContentProblems(campaign);
    problems.push(...contentProblems);

    const recipients = await models.CampaignLead.findAll({ where: { campaignId: campaign.id } });
    const withEmail = recipients.filter((r) => r.email && /.+@.+\..+/.test(r.email));
    if (!withEmail.length) problems.push('No eligible recipients with a valid email address.');

    // PROMPT 9.1 — account pool validation (tenant-scoped, weighted-sum,
    // password presence, enabled). Falls back to the legacy single account
    // when no pool exists yet.
    const poolValidation = await require('../services/campaign-sending-account-service')
      .validatePoolForLaunch(campaign);
    if (poolValidation.accountCount === 0) {
      if (!campaign.sendingAccountId) {
        problems.push('No sending account selected.');
      } else {
        const legacy = await models.SmtpAccount.findOne({
          where: { id: campaign.sendingAccountId, organizationId: req.user.org },
        });
        if (!legacy) problems.push('Selected sending account not found.');
        else if (!legacy.isEnabled) problems.push('Selected sending account is disabled.');
        else if (!legacy.fromEmail) problems.push('Sending account has no sender identity (from email).');
      }
    } else {
      for (const issue of poolValidation.issues) problems.push(issue);
    }

    if (problems.length) {
      return res.status(422).json({ error: 'Campaign is not ready to launch.', problems, issues });
    }

    // --- queue first jobs for every eligible recipient -----------------------
    const startAt = campaign.scheduledStartAt && campaign.scheduledStartAt > new Date()
      ? campaign.scheduledStartAt
      : new Date();

    const queued = [];
    let suppressedCount = 0;
    for (const recipient of withEmail) {
      const sup = await engine.isSuppressed(campaign.organizationId, recipient.email);
      if (sup.suppressed) {
        await recipient.update({ status: 'suppressed' });
        suppressedCount++;
        continue;
      }
      const job = await engine.queueNextStepForRecipient(campaign, recipient, null, startAt);
      if (job) queued.push(job.id);
    }

    if (!queued.length) {
      return res.status(422).json({ error: 'Every recipient is suppressed; nothing to send.' });
    }

    campaign.status = 'active';
    campaign.startedAt = new Date();
    campaign.totalLeads = recipients.length;
    await campaign.save();
    realtime.emitCampaignUpdated(campaign, req.headers['x-client-id']);

    res.json({
      success: true,
      data: campaign,
      queuedJobs: queued.length,
      suppressedRecipients: suppressedCount,
    });
  } catch (error) {
    console.error('Launch campaign error:', error);
    res.status(500).json({ error: 'Failed to launch campaign' });
  }
});

// POST /api/v1/campaigns/:id/resume - resume a paused campaign.
// Queued jobs are NOT dumped: the worker re-checks schedule, delays and limits
// on every tick, so sends continue at the configured pace.
router.post('/:id/resume', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    if (!canTransition(normalizeStatus(campaign.status), 'active')) {
      return res.status(400).json({ error: `Cannot resume campaign from status: ${campaign.status}` });
    }
    // Content gate: a campaign may not re-enter the sending state without a
    // body on every email (and a subject on the first). Same bar as launch.
    const { problems, issues } = await campaignContentProblems(campaign);
    if (problems.length) {
      return res.status(422).json({ error: 'Campaign is not ready to resume.', problems, issues });
    }
    // Re-check suppression for pending recipients and requeue their next step
    // if no job is pending for them.
    const recipients = await models.CampaignLead.findAll({
      where: { campaignId: campaign.id, status: { [Op.notIn]: ['unsubscribed', 'bounced', 'suppressed', 'completed'] } },
    });
    let requeued = 0;
    for (const recipient of recipients) {
      const pending = await models.EmailJob.count({
        where: { campaignRecipientId: recipient.id, status: { [Op.in]: ['queued', 'sending'] } },
      });
      if (!pending) {
        const job = await engine.queueNextStepForRecipient(campaign, recipient, null, new Date());
        if (job) requeued++;
      }
    }
    campaign.status = 'active';
    campaign.pausedAt = null;
    await campaign.save();
    realtime.emitCampaignUpdated(campaign, req.headers['x-client-id']);
    res.json({ success: true, data: campaign, requeuedJobs: requeued });
  } catch (error) {
    console.error('Resume campaign error:', error);
    res.status(500).json({ error: 'Failed to resume campaign' });
  }
});

// POST /api/v1/campaigns/:id/archive
router.post('/:id/archive', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    if (!canTransition(normalizeStatus(campaign.status), 'archived')) {
      return res.status(400).json({ error: `Cannot archive campaign from status: ${campaign.status}` });
    }
    campaign.status = 'archived';
    campaign.archivedAt = new Date();
    await campaign.save();
    realtime.emitCampaignUpdated(campaign, req.headers['x-client-id']);
    await models.EmailJob.update(
      { status: 'cancelled' },
      { where: { campaignId: campaign.id, status: 'queued' } }
    );
    res.json({ success: true, data: campaign });
  } catch (error) {
    console.error('Archive campaign error:', error);
    res.status(500).json({ error: 'Failed to archive campaign' });
  }
});

// DELETE /api/v1/campaigns/:id - permanently delete an unfinished or archived
// campaign and everything it owns. Live/scheduled campaigns cannot be deleted
// (stop them first); lead records are never deleted — only enrollment rows.
router.delete('/:id', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await models.Campaign.findOne({
      where: { id: req.params.id, organizationId: req.user.org },
    });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (!['draft', 'archived'].includes(String(campaign.status).toLowerCase())) {
      return res.status(409).json({
        error: `Only draft or archived campaigns can be deleted (this one is ${campaign.status}). Pause, cancel or archive it first.`,
      });
    }

    const result = await sequelize.transaction(async (t) => {
      const stepIds = (await models.CampaignStep.findAll({
        attributes: ['id'],
        where: { organizationId: req.user.org },
        include: [{
          model: models.CampaignSequence, as: 'sequence',
          attributes: [], where: { campaignId: campaign.id }, required: true,
        }],
        raw: true, transaction: t,
      })).map((s) => s.id);

      const sequences = await models.CampaignSequence.findAll({
        attributes: ['id'], where: { campaignId: campaign.id }, transaction: t,
      });

      const counts = {
        variants: stepIds.length ? await models.CampaignStepVariant.destroy({ where: { stepId: stepIds }, transaction: t }) : 0,
        steps: stepIds.length ? await models.CampaignStep.destroy({ where: { id: stepIds }, transaction: t }) : 0,
        sequences: sequences.length ? await models.CampaignSequence.destroy({ where: { campaignId: campaign.id }, transaction: t }) : 0,
        sendingAccounts: await models.CampaignSendingAccount.destroy({ where: { campaignId: campaign.id }, transaction: t }),
        templates: await models.CampaignEmailTemplate.destroy({ where: { campaignId: campaign.id }, transaction: t }),
        proposals: await models.CampaignAIProposal.destroy({ where: { campaignId: campaign.id }, transaction: t }),
        jobs: await models.EmailJob.destroy({ where: { campaignId: campaign.id }, transaction: t }),
        recipients: await models.CampaignLead.destroy({ where: { campaignId: campaign.id }, transaction: t }),
        events: await models.EmailEvent.destroy({ where: { campaignId: campaign.id }, transaction: t }),
      };
      await campaign.destroy({ transaction: t });
      return counts;
    });

    realtime.emitCampaignUpdated({ id: campaign.id, status: 'deleted', organizationId: req.user.org }, req.headers['x-client-id']);
    res.json({ success: true, data: { deleted: campaign.id, ...result } });
  } catch (error) {
    console.error('Delete campaign error:', error);
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

// GET /api/v1/campaigns/:id/lifecycle - what actions are legal right now
router.get('/:id/lifecycle', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    res.json({
      success: true,
      data: { status: campaign.status, allowedTransitions: TRANSITIONS[normalizeStatus(campaign.status)] || [] },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load lifecycle' });
  }
});

// ----------------------------------------------------------------------------
// Recipients (audience). Enrollment snapshots lead details onto CampaignLead.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/v1/campaigns/:id/recipients - enroll recipients with details
router.post('/:id/recipients', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    const incoming = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
    if (!incoming.length) {
      return res.status(422).json({ error: 'recipients array is required' });
    }

    const created = [];
    const rejected = [];
    const seen = new Set();

    for (const item of incoming) {
      const email = String(item.email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) {
        rejected.push({ email, reason: 'invalid email' });
        continue;
      }
      if (seen.has(email)) {
        rejected.push({ email, reason: 'duplicate in submission' });
        continue;
      }
      seen.add(email);

      const existing = await models.CampaignLead.findOne({
        where: { campaignId: campaign.id, email },
      });
      if (existing) {
        rejected.push({ email, reason: 'already enrolled' });
        continue;
      }

      // Suppress check at enroll time → recipient starts suppressed, not queued.
      const sup = await engine.isSuppressed(campaign.organizationId, email);
      const recipient = await models.CampaignLead.create({
        campaignId: campaign.id,
        organizationId: campaign.organizationId,
        leadId: item.leadId || null,
        email,
        firstName: item.firstName || null,
        lastName: item.lastName || null,
        companyName: item.companyName || null,
        jobTitle: item.jobTitle || null,
        status: sup.suppressed ? 'suppressed' : 'pending',
      });
      created.push(recipient);
    }

    const total = await models.CampaignLead.count({ where: { campaignId: campaign.id } });
    await campaign.update({ totalLeads: total });

    res.status(201).json({
      success: true,
      data: { created, rejected },
      counts: { created: created.length, rejected: rejected.length, total },
    });
  } catch (error) {
    console.error('Enroll recipients error:', error);
    res.status(500).json({ error: 'Failed to enroll recipients' });
  }
});

// GET /api/v1/campaigns/:id/recipients - list with filters + pagination
router.get('/:id/recipients', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 25));
    const { status, search } = req.query;

    const and = [];
    if (status && status !== 'all') and.push({ status });
    if (search) {
      and.push({
        [Op.or]: [
          { email: { [Op.like]: `%${search}%` } },
          { firstName: { [Op.like]: `%${search}%` } },
          { lastName: { [Op.like]: `%${search}%` } },
          { companyName: { [Op.like]: `%${search}%` } },
        ],
      });
    }
    // Instantly "Data fields" + owner filters (via the linked lead record).
    const leadConstraint = (m) => ({
      [Op.or]: [
        { leadId: { [Op.in]: m.ids } },
        { [Op.and]: [sequelize.where(sequelize.fn('LOWER', sequelize.col('email')), { [Op.in]: m.emails })] },
      ],
    });
    if (leadFilter.hasFieldFilter(req.query)) {
      const m = await leadFilter.matchingLeads(campaign.organizationId, req.query);
      if (m) and.push(leadConstraint(m));
    }
    const owner = (req.query.owner || '').toString();
    if (owner === 'unassigned' || (owner && owner !== 'all')) {
      const ownerWhere = { organizationId: campaign.organizationId };
      if (owner === 'unassigned') ownerWhere.assignedTo = null;
      else ownerWhere.assignedTo = owner;
      const leads = await models.Lead.findAll({ where: ownerWhere, attributes: ['id', 'email'] });
      and.push(leadConstraint({ ids: leads.map((l) => l.id), emails: leads.map((l) => String(l.email || '').toLowerCase()) }));
    }

    const where = { campaignId: campaign.id };
    if (and.length) where[Op.and] = and;

    const { count, rows } = await models.CampaignLead.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      offset: (page - 1) * pageSize,
      limit: pageSize,
      distinct: true,
    });

    res.json({
      success: true,
      data: rows,
      pagination: { page, pageSize, total: count, pages: Math.ceil(count / pageSize) || 1 },
    });
  } catch (error) {
    console.error('List recipients error:', error);
    res.status(500).json({ error: 'Failed to list recipients' });
  }
});

// ============================================================================
// Instantly-style lead operations (§ multi-select bulk actions).
// POST /:id/recipients/move — move/copy selected recipients to another campaign
// ============================================================================
router.post('/:id/recipients/move', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    const { recipientIds, leadIds, targetCampaignId, copy = false, resetStatus = true, checkDuplicates = true } = req.body || {};
    const ids = Array.isArray(recipientIds) && recipientIds.length ? recipientIds : (Array.isArray(leadIds) && leadIds.length ? undefined : null);
    if (ids === null && !(Array.isArray(leadIds) && leadIds.length)) {
      return res.status(422).json({ error: 'recipientIds or leadIds is required' });
    }
    if (!targetCampaignId) return res.status(422).json({ error: 'targetCampaignId is required' });
    const result = await leadMove.moveRecipientsToCampaign({
      orgId: req.user.org,
      sourceCampaignId: campaign.id,
      targetCampaignId,
      recipientIds: ids,
      leadIds: Array.isArray(leadIds) ? leadIds : undefined,
      copy: Boolean(copy),
      resetStatus: Boolean(resetStatus),
      checkDuplicates: Boolean(checkDuplicates),
    });
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Move recipients error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to move recipients' });
  }
});

// POST /:id/recipients/move-to-list — move/copy selected recipients into a CRM list
router.post('/:id/recipients/move-to-list', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    const { recipientIds, leadIds, targetListId, copy = false } = req.body || {};
    const ids = Array.isArray(recipientIds) && recipientIds.length ? recipientIds : undefined;
    if (!ids && !(Array.isArray(leadIds) && leadIds.length)) {
      return res.status(422).json({ error: 'recipientIds or leadIds is required' });
    }
    if (!targetListId) return res.status(422).json({ error: 'targetListId is required' });
    const result = await leadMove.moveRecipientsToList({
      orgId: req.user.org,
      actorId: req.user.id,
      sourceCampaignId: campaign.id,
      listId: targetListId,
      recipientIds: ids,
      leadIds: Array.isArray(leadIds) ? leadIds : undefined,
      copy: Boolean(copy),
    });
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Move recipients to list error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to move recipients to list' });
  }
});

// DELETE /api/v1/campaigns/:id/recipients/:recipientId - remove a recipient.
// Blocked once anything has been sent (send history must stay intact).
router.delete('/:id/recipients/:recipientId', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    const recipient = await models.CampaignLead.findOne({
      where: { id: req.params.recipientId, campaignId: campaign.id },
    });
    if (!recipient) return res.status(404).json({ error: 'Recipient not found' });

    const sentCount = await models.EmailEvent.count({
      where: { campaignRecipientId: recipient.id, eventType: { [Op.in]: ['SENT', 'DELIVERED'] } },
    });
    if (sentCount > 0) {
      return res.status(409).json({ error: 'Recipient has already received emails and cannot be removed.' });
    }
    await models.EmailJob.destroy({ where: { campaignRecipientId: recipient.id, status: 'queued' } });
    await recipient.destroy();

    const total = await models.CampaignLead.count({ where: { campaignId: campaign.id } });
    await campaign.update({ totalLeads: total });
    res.json({ success: true, data: { id: req.params.recipientId } });
  } catch (error) {
    console.error('Remove recipient error:', error);
    res.status(500).json({ error: 'Failed to remove recipient' });
  }
});

// GET /api/v1/campaigns/:id/audience-counts - authoritative server-side counts
router.get('/:id/audience-counts', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;

    const recipients = await models.CampaignLead.findAll({
      where: { campaignId: campaign.id },
      attributes: ['email', 'status'],
    });

    const emails = recipients.map((r) => r.email).filter(Boolean);
    const lowerEmails = emails.map((e) => e.toLowerCase());

    // Suppression list lookups (org-wide)
    const suppressedRows = lowerEmails.length
      ? await models.Suppression.findAll({ where: { organizationId: req.user.org, email: lowerEmails } })
      : [];
    const suppressedSet = new Set(suppressedRows.map((s) => s.email));

    const seen = new Set();
    let duplicates = 0;
    for (const e of lowerEmails) {
      if (seen.has(e)) duplicates++;
      seen.add(e);
    }

    const counts = {
      total: recipients.length,
      eligible: 0,
      suppressed: 0,
      unsubscribed: 0,
      bounced: 0,
      invalid: 0,
      duplicates,
    };

    for (const r of recipients) {
      const email = (r.email || '').toLowerCase();
      if (!email || !EMAIL_RE.test(email)) { counts.invalid++; continue; }
      if (r.status === 'unsubscribed') { counts.unsubscribed++; continue; }
      if (r.status === 'bounced') { counts.bounced++; continue; }
      if (r.status === 'suppressed' || suppressedSet.has(email)) { counts.suppressed++; continue; }
      counts.eligible++;
    }

    res.json({ success: true, data: counts });
  } catch (error) {
    console.error('Audience counts error:', error);
    res.status(500).json({ error: 'Failed to compute audience counts' });
  }
});

// ----------------------------------------------------------------------------
// Events (activity feed)

// GET /api/v1/campaigns/:id/events - real email event log, newest first
router.get('/:id/events', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 30));
    const where = { campaignId: campaign.id };
    if (req.query.eventType) where.eventType = req.query.eventType;

    const { count, rows } = await models.EmailEvent.findAndCountAll({
      where,
      order: [['event_timestamp', 'DESC']],
      offset: (page - 1) * pageSize,
      limit: pageSize,
    });

    res.json({
      success: true,
      data: rows,
      pagination: { page, pageSize, total: count, pages: Math.ceil(count / pageSize) || 1 },
    });
  } catch (error) {
    console.error('List events error:', error);
    res.status(500).json({ error: 'Failed to list email events' });
  }
});

// ----------------------------------------------------------------------------
// Preview (real variable substitution; no AI) and AI personalization

const SAMPLE_RECIPIENT = {
  firstName: 'John',
  lastName: 'Doe',
  companyName: 'Acme',
  jobTitle: 'Head of Growth',
  email: 'john@example.com',
};

// POST /api/v1/campaigns/:id/preview
// body: { stepId?, recipient? } - renders a sequence step against a real
// recipient from the campaign (or the first recipient) with actual substitution.
router.post('/:id/preview', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;

    const steps = await getOrderedSteps(campaign.id);
    if (!steps.length) return res.status(422).json({ error: 'This campaign has no sequence emails.' });

    let step = req.body?.stepId ? steps.find((s) => s.id === req.body.stepId) : steps[0];
    if (!step) return res.status(404).json({ error: 'Sequence step not found' });

    let recipient = null;
    if (req.body?.recipientId) {
      recipient = await models.CampaignLead.findOne({
        where: { id: req.body.recipientId, campaignId: campaign.id },
      });
    }
    if (!recipient) {
      recipient = await models.CampaignLead.findOne({
        where: { campaignId: campaign.id, email: { [Op.ne]: null } },
      });
    }

    const isSample = !recipient;
    const vars = engine.recipientVars(recipient
      ? recipient
      : { ...SAMPLE_RECIPIENT, email: SAMPLE_RECIPIENT.email });

    const subject = engine.renderTemplate(step.subjectTemplate, vars);
    const htmlBody = engine.renderTemplate(step.bodyTemplate, vars);

    res.json({
      success: true,
      data: {
        stepId: step.id,
        stepName: step.name,
        subject,
        html: htmlBody,
        text: engine.htmlToPlainText(htmlBody),
        sampleRecipient: recipient
          ? { email: recipient.email, firstName: recipient.firstName, lastName: recipient.lastName, companyName: recipient.companyName, jobTitle: recipient.jobTitle }
          : SAMPLE_RECIPIENT,
        isSample,
      },
    });
  } catch (error) {
    console.error('Preview error:', error);
    res.status(500).json({ error: 'Failed to render preview' });
  }
});

// POST /api/v1/campaigns/:id/personalize
// body: { stepId, recipientId?, depth? } - real AI call via the backend AI
// service. Returns 501 honestly when KIMI_API_KEY is not configured.
router.post('/:id/personalize', authenticate, checkOrgMembership, async (req, res) => {
  try {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    if (!campaign.aiPersonalizationEnabled) {
      return res.status(400).json({ error: 'AI personalization is disabled for this campaign.' });
    }

    const steps = await getOrderedSteps(campaign.id);
    const step = req.body?.stepId ? steps.find((s) => s.id === req.body.stepId) : steps[0];
    if (!step) return res.status(404).json({ error: 'Sequence step not found' });

    let recipient = null;
    if (req.body?.recipientId) {
      recipient = await models.CampaignLead.findOne({
        where: { id: req.body.recipientId, campaignId: campaign.id },
      });
    }
    if (!recipient) {
      recipient = await models.CampaignLead.findOne({
        where: { campaignId: campaign.id, email: { [Op.ne]: null } },
      });
    }
    if (!recipient) {
      return res.status(422).json({ error: 'Add at least one recipient to generate an AI preview.' });
    }

    const vars = engine.recipientVars(recipient);
    const depth = req.body?.depth || campaign.aiPersonalizationDepth || 'standard';
    const personalized = await aiService.personalizeText({
      template: step.bodyTemplate,
      vars,
      depth,
    });

    res.json({
      success: true,
      data: {
        stepId: step.id,
        recipientId: recipient.id,
        depth,
        originalSubject: step.subjectTemplate,
        originalBody: step.bodyTemplate,
        personalizedBody: personalized,
        renderedSubject: engine.renderTemplate(step.subjectTemplate, vars),
      },
    });
  } catch (error) {
    if (error.statusCode === 501) {
      return res.status(501).json({ error: error.message, code: 'AI_NOT_CONFIGURED' });
    }
    if (error.statusCode === 502 || error.statusCode === 504) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Personalize error:', error);
    res.status(500).json({ error: 'Failed to generate AI personalization' });
  }
});

// ============================================================================
// Export router
// ============================================================================

module.exports = router;