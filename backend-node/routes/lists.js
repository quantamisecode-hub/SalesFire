// CRM Lists routes — holding lists for leads not in campaigns (Instantly parity).
// Leads in lists do not count toward any campaign's audience. Tenancy from the
// token only; mutations require write permission (OWNER/ADMIN/member/editor).
const express = require('express');
const { Op } = require('sequelize');
const models = require('../models');
const { verifyAccessToken } = require('../security');
const leadMove = require('../services/lead-move');
const { LeadList, LeadListMember, Lead } = models;

const router = express.Router();

router.use((req, res, next) => {
  const token = req.cookies?.access_token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, org: payload.org, roles: payload.roles || [] };
    if (!req.user.org) return res.status(403).json({ error: 'No organization membership' });
    req.isPrivileged = ['owner', 'admin'].includes(String(req.user.roles?.[0] || '').toLowerCase());
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
});

function canWrite(req) {
  return req.isPrivileged || ['member', 'editor', 'manager'].includes(String(req.user.roles?.[0] || '').toLowerCase());
}

function serializeList(list, count) {
  return {
    id: list.id,
    name: list.name,
    description: list.description || null,
    createdBy: list.createdBy || null,
    memberCount: count,
    createdAt: list.createdAt,
    updatedAt: list.updatedAt,
  };
}

// GET /api/v1/lists — all lists with member counts.
router.get('/', async (req, res) => {
  try {
    const lists = await LeadList.findAll({ where: { organizationId: req.user.org }, order: [['name', 'ASC']] });
    const [rows] = await require('../db').sequelize.query(
      'SELECT list_id AS listId, COUNT(*) AS count FROM lead_list_members WHERE organization_id = :org GROUP BY list_id',
      { replacements: { org: req.user.org } }
    );
    const byList = new Map(rows.map((c) => [c.listId, Number(c.count)]));
    res.json({ success: true, data: lists.map((l) => serializeList(l, byList.get(l.id) || 0)) });
  } catch (error) {
    console.error('Lists list error:', error);
    res.status(500).json({ error: 'Failed to list lists' });
  }
});

// POST /api/v1/lists — create a list.
router.post('/', async (req, res) => {
  try {
    if (!canWrite(req)) return res.status(403).json({ error: 'You do not have permission' });
    const name = String(req.body?.name || '').trim().slice(0, 255);
    if (!name) return res.status(422).json({ error: 'List name is required' });
    const exists = await LeadList.findOne({ where: { organizationId: req.user.org, name } });
    if (exists) return res.status(409).json({ error: 'A list with this name already exists' });
    const list = await LeadList.create({
      organizationId: req.user.org,
      name,
      description: String(req.body?.description || '').slice(0, 2000) || null,
      createdBy: req.user.id,
    });
    res.status(201).json({ success: true, data: serializeList(list, 0) });
  } catch (error) {
    console.error('List create error:', error);
    res.status(500).json({ error: 'Failed to create list' });
  }
});

// GET /api/v1/lists/:id — list detail: members (paginated, searchable).
router.get('/:id', async (req, res) => {
  try {
    const list = await LeadList.findOne({ where: { id: req.params.id, organizationId: req.user.org } });
    if (!list) return res.status(404).json({ error: 'List not found' });
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 25));
    const search = (req.query.search || '').trim();

    const where = { listId: list.id, organizationId: req.user.org };
    let leadIds = null;
    if (search) {
      const like = { [Op.like]: `%${search}%` };
      const matches = await Lead.findAll({
        where: { organizationId: req.user.org, [Op.or]: [{ email: like }, { firstName: like }, { lastName: like }, { companyName: like }] },
        attributes: ['id'],
      });
      leadIds = matches.map((m) => m.id);
      where.leadId = { [Op.in]: leadIds };
    }

    // Server-side sorting — whitelist only. Lead-field sorts are applied in JS
    // over the (org-scoped, small) member set; addedAt uses SQL order directly.
    const sortBy = (req.query.sortBy || '').toString();
    const sortDir = (req.query.sortDir || 'desc').toString().toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const LEAD_SORTS = { name: 'fullName', company: 'companyName', email: 'email', status: 'status' };
    let count, rows, byId;
    if (sortBy && LEAD_SORTS[sortBy]) {
      const all = await LeadListMember.findAll({ where });
      const leads = await Lead.findAll({ where: { id: { [Op.in]: all.map((r) => r.leadId) }, organizationId: req.user.org } });
      byId = new Map(leads.map((l) => [l.id, l]));
      const sorted = all.slice().sort((a, b) => {
        const la = byId.get(a.leadId), lb = byId.get(b.leadId);
        const val = (l) => {
          if (!l) return '';
          return (LEAD_SORTS[sortBy] === 'fullName'
            ? `${l.lastName || ''} ${l.firstName || ''}`
            : String(l[LEAD_SORTS[sortBy]] || '')).toLowerCase();
        };
        return sortDir === 'ASC' ? val(la).localeCompare(val(lb)) : val(lb).localeCompare(val(la));
      });
      count = sorted.length;
      rows = sorted.slice((page - 1) * pageSize, page * pageSize);
    } else {
      const found = await LeadListMember.findAndCountAll({
        where,
        offset: (page - 1) * pageSize,
        limit: pageSize,
        order: [['created_at', sortBy === 'addedAt' ? sortDir : 'DESC']],
      });
      count = found.count;
      rows = found.rows;
      const leads = await Lead.findAll({ where: { id: { [Op.in]: rows.map((r) => r.leadId) }, organizationId: req.user.org } });
      byId = new Map(leads.map((l) => [l.id, l]));
    }
    res.json({
      success: true,
      data: {
        ...serializeList(list, await LeadListMember.count({ where: { listId: list.id, organizationId: req.user.org } })),
        members: rows.map((r) => ({
          id: r.id,
          leadId: r.leadId,
          addedAt: r.createdAt,
          lead: byId.get(r.leadId) ? {
            id: byId.get(r.leadId).id,
            firstName: byId.get(r.leadId).firstName,
            lastName: byId.get(r.leadId).lastName,
            companyName: byId.get(r.leadId).companyName,
            email: byId.get(r.leadId).email,
            status: byId.get(r.leadId).status,
            emailStatus: byId.get(r.leadId).emailStatus || 'unknown',
            assignedTo: byId.get(r.leadId).assignedTo || null,
          } : null,
        })),
      },
      pagination: { page, pageSize, total: count, pages: Math.ceil(count / pageSize) || 1 },
    });
  } catch (error) {
    console.error('List detail error:', error);
    res.status(500).json({ error: 'Failed to load list' });
  }
});

// PATCH /api/v1/lists/:id — rename / re-describe.
router.patch('/:id', async (req, res) => {
  try {
    if (!canWrite(req)) return res.status(403).json({ error: 'You do not have permission' });
    const list = await LeadList.findOne({ where: { id: req.params.id, organizationId: req.user.org } });
    if (!list) return res.status(404).json({ error: 'List not found' });
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim().slice(0, 255);
      if (!name) return res.status(422).json({ error: 'List name cannot be empty' });
      const clash = await LeadList.findOne({ where: { organizationId: req.user.org, name, id: { [Op.ne]: list.id } } });
      if (clash) return res.status(409).json({ error: 'A list with this name already exists' });
      list.name = name;
    }
    if (req.body?.description !== undefined) list.description = String(req.body.description).slice(0, 2000) || null;
    await list.save();
    res.json({ success: true, data: serializeList(list, await LeadListMember.count({ where: { listId: list.id, organizationId: req.user.org } })) });
  } catch (error) {
    console.error('List update error:', error);
    res.status(500).json({ error: 'Failed to update list' });
  }
});

// DELETE /api/v1/lists/:id — delete list (members cascade).
router.delete('/:id', async (req, res) => {
  try {
    if (!req.isPrivileged) return res.status(403).json({ error: 'Only owners and admins can delete lists' });
    const deleted = await LeadList.destroy({ where: { id: req.params.id, organizationId: req.user.org } });
    if (!deleted) return res.status(404).json({ error: 'List not found' });
    await LeadListMember.destroy({ where: { listId: req.params.id, organizationId: req.user.org } });
    res.json({ success: true });
  } catch (error) {
    console.error('List delete error:', error);
    res.status(500).json({ error: 'Failed to delete list' });
  }
});

// POST /api/v1/lists/:id/members — add leads (deduped).
router.post('/:id/members', async (req, res) => {
  try {
    if (!canWrite(req)) return res.status(403).json({ error: 'You do not have permission' });
    const list = await LeadList.findOne({ where: { id: req.params.id, organizationId: req.user.org } });
    if (!list) return res.status(404).json({ error: 'List not found' });
    const leadIds = Array.isArray(req.body?.leadIds) ? req.body.leadIds : [];
    if (!leadIds.length) return res.status(422).json({ error: 'leadIds is required' });
    const leads = await Lead.findAll({ where: { id: { [Op.in]: leadIds }, organizationId: req.user.org }, attributes: ['id'] });
    let added = 0;
    for (const lead of leads) {
      const [, created] = await LeadListMember.findOrCreate({
        where: { listId: list.id, leadId: lead.id, organizationId: req.user.org },
        defaults: { addedBy: req.user.id },
      });
      if (created) added += 1;
    }
    res.json({ success: true, data: { added, requested: leadIds.length } });
  } catch (error) {
    console.error('List members add error:', error);
    res.status(500).json({ error: 'Failed to add members' });
  }
});

// DELETE /api/v1/lists/:id/members — remove leads from the list.
router.delete('/:id/members', async (req, res) => {
  try {
    if (!canWrite(req)) return res.status(403).json({ error: 'You do not have permission' });
    const list = await LeadList.findOne({ where: { id: req.params.id, organizationId: req.user.org } });
    if (!list) return res.status(404).json({ error: 'List not found' });
    const leadIds = Array.isArray(req.body?.leadIds) ? req.body.leadIds : [];
    const removed = await LeadListMember.destroy({ where: { listId: list.id, leadId: { [Op.in]: leadIds }, organizationId: req.user.org } });
    res.json({ success: true, data: { removed } });
  } catch (error) {
    console.error('List members remove error:', error);
    res.status(500).json({ error: 'Failed to remove members' });
  }
});

// POST /api/v1/lists/:id/move-to-campaign — enroll the list's members (optionally keeping them in the list).
router.post('/:id/move-to-campaign', async (req, res) => {
  try {
    if (!canWrite(req)) return res.status(403).json({ error: 'You do not have permission' });
    const { targetCampaignId, copy = false, resetStatus = true, checkDuplicates = true, leadIds } = req.body || {};
    if (!targetCampaignId) return res.status(422).json({ error: 'targetCampaignId is required' });
    const result = await leadMove.moveListToCampaign({
      orgId: req.user.org,
      listId: req.params.id,
      targetCampaignId,
      copy: Boolean(copy),
      resetStatus: Boolean(resetStatus),
      checkDuplicates: Boolean(checkDuplicates),
      leadIds: Array.isArray(leadIds) && leadIds.length ? leadIds : undefined,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('List move-to-campaign error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Failed to move list to campaign' });
  }
});

module.exports = router;
