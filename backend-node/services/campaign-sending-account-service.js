// CampaignSendingAccountService — PROMPT 9.1 §52.
// Pool membership management for a campaign: add/remove/configure weights,
// org-ownership enforcement, distribution validation, remove-with-scheduled-
// recipients handling.
const models = require('../models');

const DISTRIBUTIONS = ['round_robin', 'weighted', 'availability_based'];

function validateDistribution(strategy) {
  if (!DISTRIBUTIONS.includes(strategy)) {
    return { ok: false, error: `distribution must be one of ${DISTRIBUTIONS.join(', ')}` };
  }
  return { ok: true };
}

/** Create/replace a pool membership. Account MUST belong to the org. */
async function addAccountToCampaign({ campaign, smtpAccountId, weight = 100 }) {
  const account = await models.SmtpAccount.findOne({
    where: { id: smtpAccountId, organizationId: campaign.organizationId },
  });
  if (!account) {
    return { ok: false, status: 404, error: 'Sending account not found in this organization' };
  }
  const [row, created] = await models.CampaignSendingAccount.findOrCreate({
    where: { campaignId: campaign.id, smtpAccountId: account.id },
    defaults: {
      organizationId: campaign.organizationId,
      weight: clampWeight(weight),
      enabled: true,
    },
  });
  if (!created) {
    row.enabled = true;
    row.weight = clampWeight(weight);
    await row.save();
  }
  return { ok: true, pool: row, created };
}

function clampWeight(w) {
  const n = parseInt(w, 10);
  if (Number.isNaN(n)) return 100;
  return Math.max(0, Math.min(100, n));
}

/** Update a pool membership (weight / enabled). */
async function updatePoolRow({ campaign, poolId, weight, enabled }) {
  const row = await models.CampaignSendingAccount.findOne({
    where: { id: poolId, campaignId: campaign.id, organizationId: campaign.organizationId },
  });
  if (!row) return { ok: false, status: 404, error: 'Pool entry not found' };
  if (weight !== undefined) row.weight = clampWeight(weight);
  if (enabled !== undefined) row.enabled = Boolean(enabled);
  await row.save();
  return { ok: true, pool: row };
}

/**
 * Removing a pool account may orphan scheduled recipients. Returns the count
 * so the route can require an explicit `removalPolicy`:
 *   'reassign' — clear sending_account_id so the next send re-allocates
 *   'keep'     — keep assignments until they complete
 *   'cancel'   — cancel queued jobs tied to this account for the campaign
 */
async function removeAccountFromCampaign({ campaign, poolId, removalPolicy }) {
  const row = await models.CampaignSendingAccount.findOne({
    where: { id: poolId, campaignId: campaign.id, organizationId: campaign.organizationId },
  });
  if (!row) return { ok: false, status: 404, error: 'Pool entry not found' };

  const scheduled = await models.CampaignLead.count({
    where: { campaignId: campaign.id, sendingAccountId: row.smtpAccountId, status: ['pending', 'queued', 'active'] },
  });

  if (scheduled > 0 && !['reassign', 'keep', 'cancel'].includes(removalPolicy || '')) {
    return {
      ok: false,
      status: 409,
      requiresPolicy: true,
      scheduledRecipients: scheduled,
      message: `This account currently has ${scheduled} scheduled recipient(s). Choose what should happen.`,
    };
  }

  if (removalPolicy === 'reassign') {
    await models.CampaignLead.update(
      { sendingAccountId: null, assignmentMethod: null, assignedAt: null },
      { where: { campaignId: campaign.id, sendingAccountId: row.smtpAccountId, status: ['pending', 'queued', 'active'] } }
    );
  } else if (removalPolicy === 'cancel') {
    await models.EmailJob.update(
      { status: 'cancelled' },
      { where: { campaignId: campaign.id, sendingAccountId: row.smtpAccountId, status: 'queued' } }
    );
    await models.CampaignLead.update(
      { status: 'cancelled', sendingAccountId: null },
      { where: { campaignId: campaign.id, sendingAccountId: row.smtpAccountId, status: ['pending', 'queued', 'active'] } }
    );
  }
  // 'keep' — leave recipient assignments untouched.

  await row.destroy();
  return { ok: true, scheduledRecipients: scheduled };
}

/**
 * Validate pool for launch: for weighted distribution the enabled weights must
 * total exactly 100. Returns structured issues list. A legacy campaign with no
 * pool rows but a `sendingAccountId` pointing at an org-owned account is
 * accepted as an implicit pool of one (mirrors the allocator's fallback).
 */
async function validatePoolForLaunch(campaign) {
  const issues = [];
  const pool = await models.CampaignSendingAccount.findAll({
    where: { campaignId: campaign.id, organizationId: campaign.organizationId, enabled: true },
    include: [{ model: models.SmtpAccount, as: 'account' }],
  });
  let rows = pool.filter((r) => r.account && r.account.organizationId === campaign.organizationId);

  if (rows.length === 0 && campaign.sendingAccountId) {
    const legacy = await models.SmtpAccount.findOne({
      where: { id: campaign.sendingAccountId, organizationId: campaign.organizationId },
    });
    if (legacy) {
      // Implicit pool of one — weight is definitionally 100%.
      rows = [{ account: legacy, weight: 100, enabled: true }];
    }
  }

  if (rows.length === 0) issues.push('No sending accounts assigned to the campaign.');

  for (const row of rows) {
    const a = row.account;
    if (!a.isEnabled) issues.push(`${a.fromEmail} is disabled.`);
    if (!a.smtpPasswordEncrypted) issues.push(`${a.fromEmail} has no SMTP password configured.`);
    if (a.status === 'error') issues.push(`${a.fromEmail} failed its last SMTP connection test.`);
  }

  const strategy = campaign.accountDistribution || 'round_robin';
  if (!DISTRIBUTIONS.includes(strategy)) issues.push(`Unknown distribution strategy "${strategy}".`);
  if (strategy === 'weighted') {
    const total = rows.reduce((sum, r) => sum + (r.weight || 0), 0);
    if (total !== 100) issues.push(`Distribution must equal 100%. Current total: ${total}%.`);
  }

  return { ok: issues.length === 0, issues, accountCount: rows.length, strategy };
}

module.exports = {
  DISTRIBUTIONS,
  validateDistribution,
  addAccountToCampaign,
  updatePoolRow,
  removeAccountFromCampaign,
  validatePoolForLaunch,
};
