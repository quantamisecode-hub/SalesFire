// LeadMove — Instantly-style "Move to another campaign / list" (copy or move,
// with duplicate checking and interest-status reset).
//
// Rules enforced here (not in the UI):
//   * Target must exist and belong to the same organization.
//   * Duplicate in target campaign → skipped (reason duplicate_target).
//   * Optional checkDuplicates: enrolled in ANY other campaign → skipped (duplicate_other_campaign).
//   * Move (not copy) is blocked when the recipient has SENT/DELIVERED events —
//     deleting the source row would orphan the send history. Use copy instead.
//   * Queued (not yet sent) jobs are cancelled for moved recipients so nothing
//     double-sends.
//   * resetStatus resets only manual interest statuses (interested/won/lost/…)
//     to 'new'; progression statuses (contacted/replied/…) are preserved.
const { Op } = require('sequelize');
const models = require('../models');
const { sequelize } = require('../db');
const { INTEREST_STATUSES } = require('../models/lead');

const eqEmail = (email) => String(email || '').trim().toLowerCase();

async function findLeadsForRecipients(orgId, recipients, transaction) {
  const byId = new Map();
  const byEmail = new Map();
  const leadIds = [...new Set(recipients.map((r) => r.leadId).filter(Boolean))];
  const emails = [...new Set(recipients.map((r) => eqEmail(r.email)).filter(Boolean))];
  const found = await models.Lead.findAll({
    where: {
      organizationId: orgId,
      [Op.or]: [
        ...(leadIds.length ? [{ id: { [Op.in]: leadIds } }] : []),
        ...(emails.length ? [{ email: { [Op.in]: emails } }] : []),
      ],
    },
    transaction,
  });
  for (const lead of found) {
    if (lead.id) byId.set(lead.id, lead);
    byEmail.set(eqEmail(lead.email), lead);
  }
  return { byId, byEmail };
}

async function targetCampaignEmails(targetCampaignId, orgId, transaction) {
  const rows = await models.CampaignLead.findAll({
    where: { campaignId: targetCampaignId, organizationId: orgId },
    attributes: ['email'],
    transaction,
  });
  return new Set(rows.map((r) => eqEmail(r.email)));
}

async function otherCampaignEmails(orgId, excludeCampaignId, transaction) {
  const rows = await models.CampaignLead.findAll({
    where: { organizationId: orgId, campaignId: { [Op.ne]: excludeCampaignId } },
    attributes: ['email'],
    transaction,
  });
  return new Set(rows.map((r) => eqEmail(r.email)));
}

async function anyCampaignEmails(orgId, transaction) {
  const rows = await models.CampaignLead.findAll({
    where: { organizationId: orgId },
    attributes: ['email'],
    transaction,
  });
  return new Set(rows.map((r) => eqEmail(r.email)));
}

/** Create a pending recipient in the target campaign. Caller handles dedupe. */
async function createRecipient(orgId, targetCampaign, lead, transaction) {
  return models.CampaignLead.create({
    campaignId: targetCampaign.id,
    organizationId: orgId,
    leadId: lead.id,
    status: 'pending',
    email: lead.email,
    firstName: lead.firstName,
    lastName: lead.lastName,
    companyName: lead.companyName,
    jobTitle: lead.jobTitle,
    addedAt: new Date(),
  }, { transaction });
}

async function resetInterestStatus(lead, transaction) {
  if (lead && INTEREST_STATUSES.includes(lead.status)) {
    await lead.update({ status: 'new' }, { transaction });
  }
}

async function refreshCampaignTotals(orgId, campaignIds, transaction) {
  for (const campaignId of new Set(campaignIds)) {
    const total = await models.CampaignLead.count({ where: { campaignId, organizationId: orgId }, transaction });
    await models.Campaign.update({ totalLeads: total }, { where: { id: campaignId, organizationId: orgId }, transaction });
  }
}

/** Resolve the source-campaign recipients either by recipient ids or by lead ids (org-scoped, campaign-scoped). */
async function sourceRecipients(orgId, sourceCampaignId, { recipientIds, leadIds }, transaction) {
  if (Array.isArray(recipientIds) && recipientIds.length) {
    return models.CampaignLead.findAll({
      where: { id: { [Op.in]: recipientIds }, campaignId: sourceCampaignId, organizationId: orgId },
      transaction,
    });
  }
  if (Array.isArray(leadIds) && leadIds.length) {
    const leads = await models.Lead.findAll({ where: { id: { [Op.in]: leadIds }, organizationId: orgId }, attributes: ['id', 'email'], transaction });
    const emails = leads.map((l) => eqEmail(l.email)).filter(Boolean);
    return models.CampaignLead.findAll({
      where: {
        campaignId: sourceCampaignId,
        organizationId: orgId,
        [Op.or]: [
          { leadId: { [Op.in]: leads.map((l) => l.id) } },
          ...(emails.length ? [{ email: { [Op.in]: emails } }] : []),
        ],
      },
      transaction,
    });
  }
  const e = new Error('recipientIds or leadIds is required'); e.statusCode = 422; throw e;
}

/**
 * Move/copy selected recipients of a campaign into another campaign.
 * Returns { moved, copied, skipped: [{ email, reason }] }.
 */
async function moveRecipientsToCampaign({ orgId, sourceCampaignId, targetCampaignId, recipientIds, leadIds, copy = false, resetStatus = true, checkDuplicates = true }) {
  if (!Array.isArray(recipientIds) && !Array.isArray(leadIds)) {
    const e = new Error('recipientIds or leadIds is required'); e.statusCode = 422; throw e;
  }
  if (sourceCampaignId === targetCampaignId) {
    const e = new Error('Source and target campaigns are the same'); e.statusCode = 422; throw e;
  }
  const target = await models.Campaign.findOne({ where: { id: targetCampaignId, organizationId: orgId } });
  if (!target) { const e = new Error('Target campaign not found'); e.statusCode = 404; throw e; }

  const result = { moved: 0, copied: 0, skipped: [] };
  await sequelize.transaction(async (t) => {
    const recipients = await sourceRecipients(orgId, sourceCampaignId, { recipientIds, leadIds }, t);
    const { byId, byEmail } = await findLeadsForRecipients(orgId, recipients, t);
    const targetTaken = await targetCampaignEmails(targetCampaignId, orgId, t);
    const elsewhere = checkDuplicates ? await otherCampaignEmails(orgId, sourceCampaignId, t) : new Set();

    for (const rec of recipients) {
      const email = eqEmail(rec.email);
      const lead = (rec.leadId && byId.get(rec.leadId)) || byEmail.get(email);
      if (!lead) { result.skipped.push({ email, reason: 'lead_not_found' }); continue; }
      if (targetTaken.has(email)) { result.skipped.push({ email, reason: 'duplicate_target' }); continue; }
      if (checkDuplicates && elsewhere.has(email)) { result.skipped.push({ email, reason: 'duplicate_other_campaign' }); continue; }
      if (!copy) {
        const hasHistory = await models.EmailEvent.count({
          where: { campaignRecipientId: rec.id, eventType: { [Op.in]: ['SENT', 'DELIVERED'] } },
          transaction: t,
        });
        if (hasHistory > 0) { result.skipped.push({ email, reason: 'has_send_history' }); continue; }
      }
      await createRecipient(orgId, target, lead, t);
      targetTaken.add(email);
      if (copy) {
        result.copied += 1;
      } else {
        // Cancel not-yet-sent jobs so nothing double-sends from the source.
        await models.EmailJob.destroy({ where: { campaignRecipientId: rec.id, status: 'queued' }, transaction: t });
        await rec.destroy({ transaction: t });
        result.moved += 1;
      }
      if (resetStatus) await resetInterestStatus(lead, t);
    }
    await refreshCampaignTotals(orgId, [sourceCampaignId, targetCampaignId], t);
  });
  return result;
}

/** Move/copy selected recipients of a campaign into a CRM list. */
async function moveRecipientsToList({ orgId, actorId, sourceCampaignId, listId, recipientIds, leadIds, copy = false }) {
  if (!Array.isArray(recipientIds) && !Array.isArray(leadIds)) {
    const e = new Error('recipientIds or leadIds is required'); e.statusCode = 422; throw e;
  }
  const list = await models.LeadList.findOne({ where: { id: listId, organizationId: orgId } });
  if (!list) { const e = new Error('List not found'); e.statusCode = 404; throw e; }

  const result = { added: 0, copied: 0, skipped: [] };
  await sequelize.transaction(async (t) => {
    const recipients = await sourceRecipients(orgId, sourceCampaignId, { recipientIds, leadIds }, t);
    const { byId, byEmail } = await findLeadsForRecipients(orgId, recipients, t);
    const existing = new Set((await models.LeadListMember.findAll({ where: { listId, organizationId: orgId }, attributes: ['leadId'], transaction: t })).map((m) => m.leadId));

    for (const rec of recipients) {
      const email = eqEmail(rec.email);
      const lead = (rec.leadId && byId.get(rec.leadId)) || byEmail.get(email);
      if (!lead) { result.skipped.push({ email, reason: 'lead_not_found' }); continue; }
      if (existing.has(lead.id)) { result.skipped.push({ email, reason: 'duplicate_list' }); continue; }
      await models.LeadListMember.create({ listId, leadId: lead.id, organizationId: orgId, addedBy: actorId }, { transaction: t });
      existing.add(lead.id);
      if (copy) {
        result.copied += 1;
        continue;
      }
      const hasHistory = await models.EmailEvent.count({
        where: { campaignRecipientId: rec.id, eventType: { [Op.in]: ['SENT', 'DELIVERED'] } },
        transaction: t,
      });
      if (hasHistory > 0) {
        result.skipped.push({ email, reason: 'has_send_history_kept_in_campaign' });
        continue;
      }
      await models.EmailJob.destroy({ where: { campaignRecipientId: rec.id, status: 'queued' }, transaction: t });
      await rec.destroy({ transaction: t });
      result.added += 1;
    }
    await refreshCampaignTotals(orgId, [sourceCampaignId], t);
  });
  return result;
}

/** Move/copy all members of a list into a campaign (Instantly "Move to campaign"). */
async function moveListToCampaign({ orgId, listId, targetCampaignId, copy = false, resetStatus = true, checkDuplicates = true, leadIds }) {
  const list = await models.LeadList.findOne({ where: { id: listId, organizationId: orgId } });
  if (!list) { const e = new Error('List not found'); e.statusCode = 404; throw e; }
  const target = await models.Campaign.findOne({ where: { id: targetCampaignId, organizationId: orgId } });
  if (!target) { const e = new Error('Target campaign not found'); e.statusCode = 404; throw e; }

  const result = { moved: 0, copied: 0, skipped: [] };
  await sequelize.transaction(async (t) => {
    const memberWhere = { listId, organizationId: orgId };
    if (Array.isArray(leadIds) && leadIds.length) memberWhere.leadId = { [Op.in]: leadIds };
    const members = await models.LeadListMember.findAll({ where: memberWhere, transaction: t });
    const leads = await models.Lead.findAll({
      where: { id: { [Op.in]: members.map((m) => m.leadId) }, organizationId: orgId },
      transaction: t,
    });
    const byId = new Map(leads.map((l) => [l.id, l]));
    const targetTaken = await targetCampaignEmails(targetCampaignId, orgId, t);
    const elsewhere = checkDuplicates ? await anyCampaignEmails(orgId, t) : new Set();

    for (const member of members) {
      const lead = byId.get(member.leadId);
      const email = lead ? eqEmail(lead.email) : '';
      if (!lead) { result.skipped.push({ email: 'unknown', reason: 'lead_not_found' }); continue; }
      if (targetTaken.has(email)) { result.skipped.push({ email, reason: 'duplicate_target' }); continue; }
      if (checkDuplicates && elsewhere.has(email)) { result.skipped.push({ email, reason: 'duplicate_other_campaign' }); continue; }
      await createRecipient(orgId, target, lead, t);
      targetTaken.add(email);
      if (copy) {
        result.copied += 1;
      } else {
        await member.destroy({ transaction: t });
        result.moved += 1;
      }
      if (resetStatus) await resetInterestStatus(lead, t);
    }
    await refreshCampaignTotals(orgId, [targetCampaignId], t);
  });
  return result;
}

module.exports = { moveRecipientsToCampaign, moveRecipientsToList, moveListToCampaign };
