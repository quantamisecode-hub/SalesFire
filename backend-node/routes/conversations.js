// Unified Inbox routes — conversations, thread view, actions, reply, drafts,
// AI helpers, sync triggers. Tenancy from the token only; mutations require
// write permission. Unread counts are always computed live (no drift).
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { Op } = require('sequelize');
const models = require('../models');
const { verifyAccessToken } = require('../security');
const { audit } = require('../services/audit');
const { sendReply, ReplyError } = require('../services/reply-service');
const inboxAi = require('../services/inbox-ai');
const { syncAccount } = require('../services/inbound-email-sync');

const router = express.Router();
const { Conversation, EmailMessage, ConversationDraft, ConversationInsight, Notification } = models;

// AI endpoints are strictly rate limited (per user).
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req),
  message: { error: 'Too many AI requests — slow down and try again in a minute.' },
});

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

const SORTS = new Set(['last_message_at', 'oldest', 'unread']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function findConversation(req, res) {
  const conv = await Conversation.findOne({
    where: { id: req.params.id, organizationId: req.user.org },
    include: [
      { model: models.Lead, as: 'lead', attributes: ['id', 'firstName', 'lastName', 'companyName', 'email', 'jobTitle', 'status', 'emailStatus', 'leadScore'] },
      { model: models.Campaign, as: 'campaign', attributes: ['id', 'name', 'status'] },
      { model: models.SmtpAccount, as: 'sendingAccount', attributes: ['id', 'name', 'fromEmail', 'fromName', 'isEnabled'] },
      { model: models.User, as: 'assignee', attributes: ['id', 'fullName', 'email'] },
    ],
  });
  if (!conv) { res.status(404).json({ error: 'Conversation not found' }); return null; }
  return conv;
}

async function unreadCounts(orgId, conversationIds) {
  if (!conversationIds.length) return new Map();
  const rows = await EmailMessage.findAll({
    where: { organizationId: orgId, conversationId: { [Op.in]: conversationIds }, direction: 'inbound', isRead: false },
    attributes: ['conversationId', [EmailMessage.sequelize.fn('COUNT', '*'), 'count']],
    group: ['conversationId'],
    raw: true,
  });
  return new Map(rows.map((r) => [r.conversationId, Number(r.count || r['count(*)'] || 0)]));
}

function serializeListItem(conv, unread, snippet) {
  const account = conv.sendingAccount;
  const campaign = conv.campaign;
  const lead = conv.lead;
  const assignee = conv.assignee;
  return {
    id: conv.id,
    subject: conv.subject,
    status: conv.status,
    unread,
    isStarred: conv.isStarred,
    isArchived: conv.isArchived,
    snoozedUntil: conv.snoozedUntil,
    threadStatus: conv.threadStatus,
    tags: conv.tags || [],
    assigneeId: conv.assignedUserId || null,
    assigneeName: assignee?.fullName || null,
    accountEmail: account?.fromEmail || null,
    campaignId: campaign?.id || null,
    campaignName: campaign?.name || null,
    lead: lead ? {
      id: lead.id, firstName: lead.firstName, lastName: lead.lastName,
      companyName: lead.companyName, email: lead.email, jobTitle: lead.jobTitle,
      status: lead.status, emailStatus: lead.emailStatus, leadScore: lead.leadScore,
    } : null,
    snippet: snippet?.snippet || null,
    lastMessageAt: conv.lastMessageAt,
    lastInboundAt: conv.lastInboundAt,
    lastOutboundAt: conv.lastOutboundAt,
    createdAt: conv.createdAt,
  };
}

async function lastMessagesByConversation(orgId, conversationIds) {
  if (!conversationIds.length) return new Map();
  const rows = await EmailMessage.findAll({
    where: { organizationId: orgId, conversationId: { [Op.in]: conversationIds } },
    attributes: ['conversationId', 'snippet', 'direction', 'createdAt'],
    order: [['created_at', 'DESC']],
    raw: true,
  });
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.conversationId)) map.set(r.conversationId, r);
  }
  return map;
}

function buildListWhere(req) {
  const where = { organizationId: req.user.org };
  const filter = String(req.query.filter || 'all');
  const now = new Date();
  switch (filter) {
    case 'unread': return { ...where, statusLiteral: 'unread' };
    case 'assigned': return { ...where, assignedUserId: { [Op.ne]: null } };
    case 'mine': return { ...where, assignedUserId: req.user.id };
    case 'starred': return { ...where, isStarred: true };
    case 'needs_reply': return { ...where, status: 'needs_reply' };
    case 'replied': return { ...where, status: 'waiting_for_reply' };
    case 'closed': return { ...where, status: 'closed' };
    case 'archived': return { ...where, isArchived: true };
    case 'snoozed': return { ...where, snoozedUntil: { [Op.gt]: now } };
    case 'all':
    default: return { ...where, isArchived: false, [Op.or]: [{ snoozedUntil: null }, { snoozedUntil: { [Op.lte]: now } }] };
  }
}

// ---------------------------------------------------------------------------
// GET /conversations — list
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 25));
    const filter = String(req.query.filter || 'all');
    const search = String(req.query.search || '').trim();
    const sort = SORTS.has(req.query.sort) ? req.query.sort : 'last_message_at';

    const where = buildListWhere(req);
    if (req.query.campaignId) where.campaignId = String(req.query.campaignId);
    if (req.query.sendingAccountId) where.sendingAccountId = String(req.query.sendingAccountId);
    if (req.query.assignedUserId) where.assignedUserId = String(req.query.assignedUserId);
    if (req.query.tag) where.tags = { [Op.like]: `%"${String(req.query.tag).replace(/"/g, '')}"%` };

    if (filter === 'unread') {
      const ids = (await EmailMessage.findAll({
        where: { organizationId: req.user.org, direction: 'inbound', isRead: false },
        attributes: ['conversationId'],
        group: ['conversationId'],
        raw: true,
      })).map((r) => r.conversationId);
      where.id = { [Op.in]: ids.length ? ids : ['00000000-0000-0000-0000-000000000000'] };
      delete where.statusLiteral;
    }

    if (search) {
      const like = `%${search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      where[Op.and] = [
        ...(where[Op.and] || []),
        {
          [Op.or]: [
            { subject: { [Op.like]: like } },
            { '$lead.firstName$': { [Op.like]: like } },
            { '$lead.lastName$': { [Op.like]: like } },
            { '$lead.email$': { [Op.like]: like } },
            { '$lead.companyName$': { [Op.like]: like } },
            { '$campaign.name$': { [Op.like]: like } },
            { '$sendingAccount.fromEmail$': { [Op.like]: like } },
          ],
        },
      ];
    }

    const order = sort === 'oldest' ? [['lastMessageAt', 'ASC']] : [['lastMessageAt', 'DESC']];
    const { count, rows } = await Conversation.findAndCountAll({
      where,
      include: [
        { model: models.Lead, as: 'lead', attributes: ['id', 'firstName', 'lastName', 'companyName', 'email', 'jobTitle', 'status', 'emailStatus', 'leadScore'] },
        { model: models.Campaign, as: 'campaign', attributes: ['id', 'name', 'status'] },
        { model: models.SmtpAccount, as: 'sendingAccount', attributes: ['id', 'name', 'fromEmail', 'fromName', 'isEnabled'] },
        { model: models.User, as: 'assignee', attributes: ['id', 'fullName', 'email'] },
      ],
      order,
      offset: (page - 1) * pageSize,
      limit: pageSize,
      subQuery: false,
      distinct: true,
    });

    const ids = rows.map((r) => r.id);
    const [unreadMap, lastMap] = await Promise.all([unreadCounts(req.user.org, ids), lastMessagesByConversation(req.user.org, ids)]);

    res.json({
      success: true,
      data: rows.map((c) => serializeListItem(c, unreadMap.get(c.id) || 0, lastMap.get(c.id))),
      pagination: { page, pageSize, total: count, pages: Math.ceil(count / pageSize) || 1 },
    });
  } catch (error) {
    console.error('Conversations list error:', error);
    res.status(500).json({ error: 'Failed to list conversations' });
  }
});

// GET /unread-count — badge
router.get('/unread-count', async (req, res) => {
  try {
    const rows = await EmailMessage.findAll({
      where: { organizationId: req.user.org, direction: 'inbound', isRead: false },
      attributes: [[EmailMessage.sequelize.fn('COUNT', EmailMessage.sequelize.col('conversation_id')), 'threads']],
      group: ['conversation_id'],
      raw: true,
    });
    res.json({ success: true, data: { unread: rows.length } });
  } catch (error) {
    console.error('Unread count error:', error);
    res.status(500).json({ error: 'Failed to compute unread count' });
  }
});

// GET /counts — per-folder counts for the mailbox sidebar (SmartLead-style
// folder badges). One request covers every folder; mirrors buildListWhere.
router.get('/counts', async (req, res) => {
  try {
    const org = req.user.org;
    const now = new Date();
    const base = { organizationId: org };
    const folders = {
      all: { ...base, isArchived: false, [Op.or]: [{ snoozedUntil: null }, { snoozedUntil: { [Op.lte]: now } }] },
      starred: { ...base, isStarred: true },
      replied: { ...base, status: 'waiting_for_reply' },
      snoozed: { ...base, snoozedUntil: { [Op.gt]: now } },
      archived: { ...base, isArchived: true },
      mine: { ...base, assignedUserId: req.user.id },
      needs_reply: { ...base, status: 'needs_reply' },
      assigned: { ...base, assignedUserId: { [Op.ne]: null } },
      closed: { ...base, status: 'closed' },
    };
    const counts = {};
    await Promise.all(
      Object.entries(folders).map(async ([key, where]) => {
        counts[key] = await Conversation.count({ where });
      })
    );
    // Unread folder = conversations with at least one unread inbound message
    // (same definition the list route uses for filter=unread).
    const unreadRows = await EmailMessage.findAll({
      where: { organizationId: org, direction: 'inbound', isRead: false },
      attributes: ['conversationId'],
      group: ['conversationId'],
      raw: true,
    });
    const unreadIds = unreadRows.map((r) => r.conversationId);
    counts.unread = unreadIds.length
      ? await Conversation.count({ where: { organizationId: org, id: { [Op.in]: unreadIds } } })
      : 0;
    res.json({ success: true, data: counts });
  } catch (error) {
    console.error('Folder counts error:', error);
    res.status(500).json({ error: 'Failed to compute folder counts' });
  }
});

// ---------------------------------------------------------------------------
// GET /:id — detail with messages
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const conv = await findConversation(req, res);
    if (!conv) return;
    const messages = await EmailMessage.findAll({
      where: { conversationId: conv.id, organizationId: req.user.org },
      order: [['created_at', 'ASC']],
    });
    const insights = await ConversationInsight.findAll({
      where: { conversationId: conv.id, organizationId: req.user.org },
      order: [['created_at', 'DESC']],
    });
    const unread = await EmailMessage.count({
      where: { conversationId: conv.id, organizationId: req.user.org, direction: 'inbound', isRead: false },
    });
    res.json({
      success: true,
      data: {
        ...serializeListItem(conv, unread, null),
        messages: messages.map((m) => ({
          id: m.id, direction: m.direction, fromEmail: m.fromEmail, fromName: m.fromName,
          toEmails: m.toEmails, ccEmails: m.ccEmails, subject: m.subject,
          textBody: m.textBody, htmlBody: m.htmlBody, snippet: m.snippet,
          sentAt: m.sentAt, receivedAt: m.receivedAt, isRead: m.isRead,
          messageType: m.messageType, status: m.status, attachments: m.headers?.attachments || [],
          campaignId: m.campaignId, sequenceStepId: m.sequenceStepId,
          createdAt: m.createdAt,
        })),
        insights: insights.map((i) => ({
          id: i.id, type: i.type, value: i.value, confidence: i.confidence,
          model: i.model, createdAt: i.createdAt,
        })),
      },
    });
  } catch (error) {
    console.error('Conversation detail error:', error);
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /:id — status / assignment / star / archive / snooze / tags
// ---------------------------------------------------------------------------
const CONV_STATUSES = new Set(['open', 'needs_reply', 'waiting_for_reply', 'closed', 'archived', 'snoozed']);
router.patch('/:id', async (req, res) => {
  try {
    if (!canWrite(req)) return res.status(403).json({ error: 'You do not have permission' });
    const conv = await findConversation(req, res);
    if (!conv) return;
    const b = req.body || {};
    const updates = {};

    if (b.status !== undefined) {
      const s = String(b.status).toLowerCase();
      if (!CONV_STATUSES.has(s)) return res.status(422).json({ error: `Invalid conversation status '${s}'` });
      updates.status = s;
      updates.isArchived = s === 'archived';
    }
    if (b.assignedUserId !== undefined) {
      const target = b.assignedUserId;
      if (target === null || target === '') {
        updates.assignedUserId = null;
      } else {
        const member = await models.OrganizationMembership.findOne({
          where: { organizationId: req.user.org, userId: target, isActive: true },
        });
        if (!member) return res.status(422).json({ error: 'Assignee must be an active member of this organization' });
        updates.assignedUserId = target;
      }
    }
    if (b.isStarred !== undefined) updates.isStarred = Boolean(b.isStarred);
    if (b.isArchived !== undefined) updates.isArchived = Boolean(b.isArchived);
    if (b.snoozedUntil !== undefined) {
      if (b.snoozedUntil === null) {
        updates.snoozedUntil = null;
        if (updates.status === 'snoozed') updates.status = 'open';
      } else {
        const d = new Date(b.snoozedUntil);
        if (Number.isNaN(d.getTime())) return res.status(422).json({ error: 'snoozedUntil must be a valid date' });
        if (d.getTime() <= Date.now()) return res.status(422).json({ error: 'snoozedUntil must be in the future' });
        updates.snoozedUntil = d;
        updates.status = 'snoozed';
      }
    }
    if (b.tags !== undefined) {
      if (!Array.isArray(b.tags)) return res.status(422).json({ error: 'tags must be an array of strings' });
      updates.tags = b.tags.slice(0, 20).map((t) => String(t).slice(0, 60));
    }
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No supported fields to update' });

    await conv.update(updates);
    await audit(req.user.org, req.user.id, 'conversation_updated', 'conversation', conv.id, Object.keys(updates));
    res.json({ success: true, data: { id: conv.id, ...updates } });
  } catch (error) {
    console.error('Conversation patch error:', error);
    res.status(500).json({ error: 'Failed to update conversation' });
  }
});

// ---------------------------------------------------------------------------
// POST /:id/read | unread | star | unstar | archive | unarchive | snooze | assign
// ---------------------------------------------------------------------------
async function setRead(req, res, isRead) {
  const conv = await findConversation(req, res);
  if (!conv) return;
  await EmailMessage.update({ isRead }, { where: { conversationId: conv.id, organizationId: req.user.org, direction: 'inbound' } });
  const unread = await EmailMessage.count({ where: { conversationId: conv.id, organizationId: req.user.org, direction: 'inbound', isRead: false } });
  res.json({ success: true, data: { unread } });
}
router.post('/:id/read', (req, res) => setRead(req, res, true));
router.post('/:id/unread', (req, res) => setRead(req, res, false));
router.post('/read-all', async (req, res) => {
  try {
    if (!canWrite(req)) return res.status(403).json({ error: 'You do not have permission' });
    await EmailMessage.update({ isRead: true }, { where: { organizationId: req.user.org, direction: 'inbound', isRead: false } });
    res.json({ success: true });
  } catch (error) {
    console.error('Read-all error:', error);
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});
router.post('/:id/star', async (req, res) => {
  if (!canWrite(req)) return res.status(403).json({ error: 'You do not have permission' });
  const conv = await findConversation(req, res);
  if (!conv) return;
  await conv.update({ isStarred: !conv.isStarred });
  res.json({ success: true, data: { isStarred: conv.isStarred } });
});
const archiveOp = (archived) => async (req, res) => {
  if (!canWrite(req)) return res.status(403).json({ error: 'You do not have permission' });
  const conv = await findConversation(req, res);
  if (!conv) return;
  await conv.update(archived
    ? { isArchived: true, status: 'archived' }
    : { isArchived: false, status: 'open' });
  await audit(req.user.org, req.user.id, archived ? 'conversation_archived' : 'conversation_unarchived', 'conversation', conv.id);
  res.json({ success: true, data: { isArchived: conv.isArchived } });
};
router.post('/:id/archive', archiveOp(true));
router.post('/:id/unarchive', archiveOp(false));
router.post('/:id/assign', async (req, res) => {
  if (!canWrite(req)) return res.status(403).json({ error: 'You do not have permission' });
  const conv = await findConversation(req, res);
  if (!conv) return;
  const { userId } = req.body || {};
  if (!userId) {
    await conv.update({ assignedUserId: null });
    return res.json({ success: true, data: { assignedUserId: null } });
  }
  const member = await models.OrganizationMembership.findOne({ where: { organizationId: req.user.org, userId, isActive: true } });
  if (!member) return res.status(422).json({ error: 'Assignee must be an active member of this organization' });
  await conv.update({ assignedUserId: userId });
  res.json({ success: true, data: { assignedUserId: userId } });
});
router.post('/:id/tags', async (req, res) => {
  if (!canWrite(req)) return res.status(403).json({ error: 'You do not have permission' });
  const conv = await findConversation(req, res);
  if (!conv) return;
  const { tags } = req.body || {};
  if (!Array.isArray(tags)) return res.status(422).json({ error: 'tags must be an array of strings' });
  await conv.update({ tags: tags.slice(0, 20).map((t) => String(t).slice(0, 60)) });
  res.json({ success: true, data: { tags: conv.tags } });
});
router.post('/:id/snooze', async (req, res) => {
  if (!canWrite(req)) return res.status(403).json({ error: 'You do not have permission' });
  const conv = await findConversation(req, res);
  if (!conv) return;
  const { until } = req.body || {};
  if (!until) {
    await conv.update({ snoozedUntil: null, status: 'open' });
    return res.json({ success: true, data: { snoozedUntil: null } });
  }
  const d = new Date(until);
  if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) return res.status(422).json({ error: 'until must be a future date' });
  await conv.update({ snoozedUntil: d, status: 'snoozed' });
  res.json({ success: true, data: { snoozedUntil: d } });
});

// ---------------------------------------------------------------------------
// POST /:id/reply — send
// ---------------------------------------------------------------------------
router.post('/:id/reply', async (req, res) => {
  try {
    if (!canWrite(req)) return res.status(403).json({ error: 'You do not have permission to send replies' });
    const conv = await findConversation(req, res);
    if (!conv) return;
    const b = req.body || {};
    // Ensure the caller has a draft to send OR ad-hoc content.
    let draft = null;
    if (b.useDraft) {
      draft = await ConversationDraft.findOne({ where: { conversationId: conv.id, userId: req.user.id, organizationId: req.user.org } });
    }
    const result = await sendReply({
      organizationId: req.user.org,
      actorId: req.user.id,
      conversationId: conv.id,
      draft,
      subject: b.subject ?? draft?.subject ?? null,
      bodyText: b.bodyText ?? draft?.textBody ?? null,
      bodyHtml: b.bodyHtml ?? draft?.htmlBody ?? null,
      toEmails: b.toEmails || draft?.toEmails || null,
      ccEmails: b.ccEmails || draft?.ccEmails || [],
      bccEmails: b.bccEmails || draft?.bccEmails || [],
      sendingAccountId: b.sendingAccountId ?? draft?.sendingAccountId ?? null,
      signatureId: b.signatureId ?? draft?.signatureId ?? null,
    });
    if (draft) await draft.destroy().catch(() => {});
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof ReplyError) return res.status(error.statusCode).json({ error: error.message, code: error.code });
    console.error('Reply send error:', error);
    res.status(500).json({ error: 'Failed to send reply' });
  }
});

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------
router.get('/:id/draft', async (req, res) => {
  try {
    const conv = await findConversation(req, res);
    if (!conv) return;
    const draft = await ConversationDraft.findOne({ where: { conversationId: conv.id, userId: req.user.id, organizationId: req.user.org } });
    res.json({ success: true, data: draft || null });
  } catch (error) {
    console.error('Draft get error:', error);
    res.status(500).json({ error: 'Failed to load draft' });
  }
});
router.put('/:id/draft', async (req, res) => {
  try {
    if (!canWrite(req)) return res.status(403).json({ error: 'You do not have permission' });
    const conv = await findConversation(req, res);
    if (!conv) return;
    const b = req.body || {};
    const [draft] = await ConversationDraft.findOrCreate({
      where: { conversationId: conv.id, userId: req.user.id, organizationId: req.user.org },
      defaults: { organizationId: req.user.org, conversationId: conv.id, userId: req.user.id },
    });
    await draft.update({
      toEmails: b.toEmails ?? draft.toEmails,
      ccEmails: b.ccEmails ?? draft.ccEmails,
      bccEmails: b.bccEmails ?? draft.bccEmails,
      subject: b.subject ?? draft.subject,
      textBody: b.textBody ?? draft.textBody,
      htmlBody: b.htmlBody ?? draft.htmlBody,
      sendingAccountId: b.sendingAccountId ?? draft.sendingAccountId,
      signatureId: b.signatureId ?? draft.signatureId,
    });
    res.json({ success: true, data: draft });
  } catch (error) {
    console.error('Draft put error:', error);
    res.status(500).json({ error: 'Failed to save draft' });
  }
});
router.delete('/:id/draft', async (req, res) => {
  try {
    const conv = await findConversation(req, res);
    if (!conv) return;
    await ConversationDraft.destroy({ where: { conversationId: conv.id, userId: req.user.id, organizationId: req.user.org } });
    res.json({ success: true });
  } catch (error) {
    console.error('Draft delete error:', error);
    res.status(500).json({ error: 'Failed to delete draft' });
  }
});

// ---------------------------------------------------------------------------
// AI — draft / summary / insights
// ---------------------------------------------------------------------------
async function loadThreadContext(req) {
  const conv = await findConversation(req, { status: () => {}, json: () => {} });
  if (!conv) return null;
  const messages = await EmailMessage.findAll({
    where: { conversationId: conv.id, organizationId: req.user.org },
    order: [['created_at', 'ASC']],
    limit: 40,
  });
  return { conv, messages };
}
router.post('/:id/ai/reply', aiLimiter, async (req, res) => {
  try {
    if (!canWrite(req)) return res.status(403).json({ error: 'You do not have permission' });
    const ctx = await loadThreadContext(req);
    if (!ctx) return res.status(404).json({ error: 'Conversation not found' });
    const { mode = 'draft', instruction, accountName } = req.body || {};
    const draft = await inboxAi.generateReplyDraft({
      messages: ctx.messages,
      lead: ctx.conv.lead,
      instruction: instruction ? String(instruction).slice(0, 2000) : undefined,
      mode: String(mode).slice(0, 20),
      accountName: accountName || ctx.conv.sendingAccount?.fromName || ctx.conv.sendingAccount?.fromEmail,
    });
    await audit(req.user.org, req.user.id, 'inbox_ai_reply_generated', 'conversation', ctx.conv.id, { mode });
    res.json({ success: true, data: { draft } });
  } catch (error) {
    console.error('AI reply error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'AI generation failed' });
  }
});
router.post('/:id/ai/summary', aiLimiter, async (req, res) => {
  try {
    const ctx = await loadThreadContext(req);
    if (!ctx) return res.status(404).json({ error: 'Conversation not found' });
    const summary = await inboxAi.summarizeConversation({
      messages: ctx.messages,
      lead: ctx.conv.lead,
    });
    // Persist insights (independently attributable).
    const model = process.env.KIMI_MODEL || 'moonshot-v1-8k';
    const insights = [];
    for (const s of summary.buyingSignals) insights.push({ type: 'buying_signal', value: s, confidence: 0.7 });
    for (const o of summary.objections) insights.push({ type: 'objection', value: o, confidence: 0.7 });
    if (summary.suggestedNextStep) insights.push({ type: 'intent', value: summary.suggestedNextStep, confidence: 0.7 });
    for (const i of insights.slice(0, 20)) {
      await ConversationInsight.create({
        organizationId: req.user.org,
        conversationId: ctx.conv.id,
        type: i.type, value: i.value, confidence: i.confidence, model,
      }).catch(() => {});
    }
    await audit(req.user.org, req.user.id, 'inbox_ai_summary_generated', 'conversation', ctx.conv.id, {});
    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('AI summary error:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'AI summary failed' });
  }
});

// ---------------------------------------------------------------------------
// Email sync — manual trigger + status (mounted under /api/v1/email-sync)
// ---------------------------------------------------------------------------
const syncRouter = express.Router();
syncRouter.use((req, res, next) => {
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
syncRouter.get('/status', async (req, res) => {
  try {
    const accounts = await models.SmtpAccount.findAll({
      where: { organizationId: req.user.org },
      attributes: ['id', 'name', 'fromEmail', 'fromName', 'isEnabled', 'imapEnabled', 'imapHost', 'imapUsername', 'imapPasswordEncrypted'],
    });
    const states = await models.MailboxSyncState.findAll({ where: { organizationId: req.user.org } });
    const byAccount = new Map(states.map((s) => [s.sendingAccountId, s]));
    res.json({
      success: true,
      data: accounts.map((a) => {
        const s = byAccount.get(a.id);
        const configured = Boolean(a.imapEnabled && a.imapHost && a.imapUsername && a.imapPasswordEncrypted);
        return {
          accountId: a.id,
          name: a.name,
          fromEmail: a.fromEmail,
          smtpEnabled: a.isEnabled,
          imapConfigured: configured,
          status: s?.status || 'idle',
          lastSyncAt: s?.lastSyncAt || null,
          lastSuccessfulSyncAt: s?.lastSuccessfulSyncAt || null,
          consecutiveFailures: s?.consecutiveFailures || 0,
          errorCode: s?.errorCode || null,
          errorMessage: s?.errorMessage || null,
        };
      }),
    });
  } catch (error) {
    console.error('Sync status error:', error);
    res.status(500).json({ error: 'Failed to load sync status' });
  }
});
syncRouter.post('/:accountId', async (req, res) => {
  try {
    if (!['owner', 'admin', 'member', 'editor'].includes(String(req.user.roles?.[0] || '').toLowerCase())) {
      return res.status(403).json({ error: 'You do not have permission' });
    }
    const account = await models.SmtpAccount.findOne({ where: { id: req.params.accountId, organizationId: req.user.org } });
    if (!account) return res.status(404).json({ error: 'Sending account not found' });
    if (!account.imapEnabled) return res.status(409).json({ error: 'IMAP sync is not enabled for this account' });
    const result = await syncAccount(account);
    res.json({ success: result.ok !== false, data: result });
  } catch (error) {
    console.error('Manual sync error:', error);
    res.status(500).json({ error: 'Failed to synchronize mailbox' });
  }
});

module.exports = { conversationsRouter: router, syncRouter };
