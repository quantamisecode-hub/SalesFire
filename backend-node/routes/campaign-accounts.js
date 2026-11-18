// PROMPT 9.1 — Campaign sending-account pool routes (mounted at /api/v1/campaigns).
//
//   GET    /api/v1/campaigns/:campaignId/sending-accounts
//   POST   /api/v1/campaigns/:campaignId/sending-accounts          (add)
//   PATCH  /api/v1/campaigns/:campaignId/sending-accounts/:poolId  (weight/enabled)
//   DELETE /api/v1/campaigns/:campaignId/sending-accounts/:poolId  (policy-aware)
//   POST   /api/v1/campaigns/:campaignId/sending-accounts/validate
//   PATCH  /api/v1/campaigns/:campaignId/sending-settings          (strategy/stickiness/fallback)
//
// Org scoping comes ONLY from the verified token. Mutations require OWNER/ADMIN.
const express = require('express');
const models = require('../models');
const { verifyAccessToken } = require('../security');
const realtime = require('../services/realtime');
const poolService = require('../services/campaign-sending-account-service');
const allocator = require('../services/sending-account-allocator');
const { audit } = require('../services/audit');

const router = express.Router({ mergeParams: true });

function authenticate(req, res, next) {
  const token = req.cookies?.access_token;
  if (!token) return res.status(401).json({ error: 'Unauthorized - no access token' });
  try {
    const payload = verifyAccessToken(token);
    if (!payload) return res.status(401).json({ error: 'Unauthorized - invalid access token' });
    req.user = { id: payload.sub, org: payload.org, roles: payload.roles || [] };
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized - token validation failed' });
  }
}
router.use(authenticate);

function isPrivileged(req) {
  const role = String(req.user.roles?.[0] || '').toLowerCase();
  return ['owner', 'admin'].includes(role);
}
function requirePrivileged(req, res, next) {
  if (!isPrivileged(req)) {
    return res.status(403).json({ error: 'Only owners and admins can manage campaign sending accounts' });
  }
  next();
}

async function loadCampaign(req, res) {
  const campaign = await models.Campaign.findOne({
    where: { id: req.params.campaignId, organizationId: req.user.org },
  });
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return null;
  }
  return campaign;
}

function poolView(row) {
  return {
    id: row.poolId,
    accountId: row.accountId,
    email: row.email,
    name: row.name,
    fromName: row.fromName,
    status: row.status,
    healthStatus: row.healthStatus,
    warmupStatus: row.warmupStatus,
    isEnabled: row.isEnabled,
    dailyLimit: row.dailyLimit,
    sentToday: row.sentToday,
    remainingToday: row.remainingToday,
    hourlyLimit: row.hourlyLimit,
    sentThisHour: row.sentThisHour,
    remainingThisHour: row.remainingThisHour,
    distribution: row.weight,
    weight: row.weight,
    lastSentAt: row.lastSentAt,
    activeCampaigns: row.activeCampaigns,
    timezone: row.timezone,
  };
}

// GET — pool with live usage for UI tables (§20).
router.get('/:campaignId/sending-accounts', async (req, res) => {
  try {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    const summary = await allocator.poolSummary(campaign);
    const strategy = campaign.accountDistribution || 'round_robin';
    res.json({
      success: true,
      data: summary.map(poolView),
      strategy,
      stickiness: campaign.accountStickiness || 'rotate',
      fallbackPolicy: campaign.fallbackPolicy || 'reassign',
      committedDistribution: strategy === 'weighted'
        ? summary.reduce((s, r) => s + (r.weight || 0), 0)
        : null,
    });
  } catch (error) {
    console.error('List pool error:', error);
    res.status(500).json({ error: 'Failed to load sending accounts for this campaign' });
  }
});

// GET campaign sending settings (strategy block used by §41 UI + §71 review).
router.get('/:campaignId/sending-settings', async (req, res) => {
  try {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    res.json({
      success: true,
      data: {
        accountDistribution: campaign.accountDistribution || 'round_robin',
        accountStickiness: campaign.accountStickiness || 'rotate',
        fallbackPolicy: campaign.fallbackPolicy || 'reassign',
        minDelayMinutes: campaign.minDelayMinutes,
        maxDelayMinutes: campaign.maxDelayMinutes,
        maxEmailsPerDay: campaign.maxEmailsPerDay,
        hourlyLimit: campaign.hourlyLimit,
        sendDaysOfWeek: campaign.sendDaysOfWeek,
        sendBetweenStartHour: campaign.sendBetweenStartHour,
        sendBetweenEndHour: campaign.sendBetweenEndHour,
        timezone: campaign.timezone,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load sending settings' });
  }
});

// PATCH sending settings (strategy/stickiness/fallback + campaign caps).
router.patch('/:campaignId/sending-settings', requirePrivileged, async (req, res) => {
  try {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    const { accountDistribution, accountStickiness, fallbackPolicy,
            minDelayMinutes, maxDelayMinutes, maxEmailsPerDay, hourlyLimit } = req.body || {};
    if (accountDistribution !== undefined) {
      const check = poolService.validateDistribution(accountDistribution);
      if (!check.ok) return res.status(422).json({ error: check.error });
      campaign.accountDistribution = accountDistribution;
    }
    if (accountStickiness !== undefined) {
      if (!['rotate', 'sticky'].includes(accountStickiness)) {
        return res.status(422).json({ error: 'accountStickiness must be rotate or sticky' });
      }
      campaign.accountStickiness = accountStickiness;
    }
    if (fallbackPolicy !== undefined) {
      if (!['reassign', 'pause'].includes(fallbackPolicy)) {
        return res.status(422).json({ error: 'fallbackPolicy must be reassign or pause' });
      }
      campaign.fallbackPolicy = fallbackPolicy;
    }
    if (minDelayMinutes !== undefined) campaign.minDelayMinutes = parseInt(minDelayMinutes, 10) || 0;
    if (maxDelayMinutes !== undefined) campaign.maxDelayMinutes = parseInt(maxDelayMinutes, 10) || 0;
    if (campaign.minDelayMinutes != null && campaign.maxDelayMinutes != null &&
        campaign.minDelayMinutes > campaign.maxDelayMinutes) {
      return res.status(422).json({ error: 'Minimum delay cannot exceed maximum delay' });
    }
    if (maxEmailsPerDay !== undefined) campaign.maxEmailsPerDay = maxEmailsPerDay ? parseInt(maxEmailsPerDay, 10) : null;
    if (hourlyLimit !== undefined) campaign.hourlyLimit = hourlyLimit ? parseInt(hourlyLimit, 10) : null;
    await campaign.save();
    realtime.emitCampaignUpdated(campaign, req.headers['x-client-id']);
    audit(req.user.org, req.user.id, 'pool.distribution_changed', 'campaign', campaign.id, { accountDistribution: campaign.accountDistribution, accountStickiness: campaign.accountStickiness, fallbackPolicy: campaign.fallbackPolicy });
    res.json({ success: true, data: { accountDistribution: campaign.accountDistribution, accountStickiness: campaign.accountStickiness, fallbackPolicy: campaign.fallbackPolicy } });
  } catch (error) {
    console.error('Update sending settings error:', error);
    res.status(500).json({ error: 'Failed to update sending settings' });
  }
});

// POST — add account to pool. Account MUST belong to the org (enforced in service).
router.post('/:campaignId/sending-accounts', requirePrivileged, async (req, res) => {
  try {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    const { smtpAccountId, weight } = req.body || {};
    if (!smtpAccountId) return res.status(422).json({ error: 'smtpAccountId is required' });
    const result = await poolService.addAccountToCampaign({ campaign, smtpAccountId, weight });
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    audit(req.user.org, req.user.id, 'pool.account_added', 'campaign', campaign.id, { smtpAccountId, weight: result.pool.weight });
    realtime.emitCampaignUpdated(campaign, req.headers['x-client-id']);
    res.status(result.created ? 201 : 200).json({ success: true, data: result.pool });
  } catch (error) {
    console.error('Add to pool error:', error);
    res.status(500).json({ error: 'Failed to add sending account to campaign' });
  }
});

// PATCH — weight / enabled for one pool row.
router.patch('/:campaignId/sending-accounts/:poolId', requirePrivileged, async (req, res) => {
  try {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    const { weight, enabled } = req.body || {};
    const result = await poolService.updatePoolRow({ campaign, poolId: req.params.poolId, weight, enabled });
    if (!result.ok) return res.status(result.status || 400).json({ error: result.error });
    audit(req.user.org, req.user.id, 'pool.weights_changed', 'campaign', campaign.id, { poolId: req.params.poolId, weight, enabled });
    res.json({ success: true, data: result.pool });
  } catch (error) {
    console.error('Update pool row error:', error);
    res.status(500).json({ error: 'Failed to update sending account pool' });
  }
});

// DELETE — remove with scheduled-recipient safety policy (§43).
router.delete('/:campaignId/sending-accounts/:poolId', requirePrivileged, async (req, res) => {
  try {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    const removalPolicy = req.body?.removalPolicy || req.query?.removalPolicy;
    const result = await poolService.removeAccountFromCampaign({
      campaign, poolId: req.params.poolId, removalPolicy,
    });
    if (!result.ok) {
      const status = result.status || 400;
      return res.status(status).json(result.requiresPolicy
        ? { error: result.message, requiresPolicy: true, scheduledRecipients: result.scheduledRecipients }
        : { error: result.error });
    }
    audit(req.user.org, req.user.id, 'pool.account_removed', 'campaign', campaign.id, { poolId: req.params.poolId, removalPolicy: removalPolicy || 'none' });
    realtime.emitCampaignUpdated(campaign, req.headers['x-client-id']);
    res.json({ success: true, scheduledRecipients: result.scheduledRecipients ?? 0 });
  } catch (error) {
    console.error('Remove from pool error:', error);
    res.status(500).json({ error: 'Failed to remove sending account from campaign' });
  }
});

// POST — validate pool (distribution sum, enabled, passwords). Launch gate.
router.post('/:campaignId/sending-accounts/validate', async (req, res) => {
  try {
    const campaign = await loadCampaign(req, res);
    if (!campaign) return;
    const result = await poolService.validatePoolForLaunch(campaign);
    res.json({ success: result.ok, ...result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to validate sending accounts' });
  }
});

module.exports = router;
