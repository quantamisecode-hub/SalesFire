// InboundEmailSyncService — real IMAP synchronization for the Unified Inbox.
//
// Design rules:
//   * IMAP (imapflow) is the supported inbound mechanism — SMTP does not receive mail.
//   * Sync is INCREMENTAL via UID cursors with UIDVALIDITY guards.
//   * Every ingested message is idempotent: (org, message_id) unique index +
//     pre-check inside the transaction. Replays create nothing twice.
//   * Campaign attribution/stopping happens only with thread evidence, in one
//     transaction with the message row. Classification is deterministic.
//   * Nothing is ever deleted; suppression changes follow the existing architecture.
//   * Injectable `fetchMessages` for deterministic tests (no IMAP server required).
const crypto = require('crypto');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { Op } = require('sequelize');

const models = require('../models');
const { sequelize } = require('../db');
const { decryptSecret } = require('./crypto');
const { audit } = require('./audit');
const classifier = require('./message-classifier');
const threading = require('./conversation-threading');
const { sanitizeHtml } = require('./template-renderer');

const MAX_MESSAGES_PER_TICK = 200;

// ---------------------------------------------------------------------------
// MIME parsing
// ---------------------------------------------------------------------------
const FINAL_RECIPIENT_RE = /final-recipient:\s*(?:rfc822;|x400;|\s)*\s*<?([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>?/i;
/** Extract the bounced recipient from a DSN's delivery-status block (raw MIME). */
function extractFinalRecipient(raw) {
  const m = String(raw || '').match(FINAL_RECIPIENT_RE);
  return m ? m[1].toLowerCase() : null;
}

function headerValue(headers, name) {
  const raw = headers?.get ? headers.get(name.toLowerCase()) : headers?.[name.toLowerCase()] ?? headers?.[name];
  if (raw == null) return '';
  return Array.isArray(raw) ? raw.join(', ') : String(raw);
}

function addrList(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((a) => ({ email: (a.address || '').toLowerCase(), name: a.name || '' })).filter((a) => a.email);
}

async function parseRawMessage(raw) {
  const parsed = await simpleParser(raw, { skipHtmlToText: true });
  const messageId = threading.normalizeMessageId(headerValue(parsed.headers, 'message-id'))
    || crypto.createHash('sha256')
      .update(`${(parsed.from?.value?.[0]?.address || '').toLowerCase()}|${(parsed.to?.value?.[0]?.address || '').toLowerCase()}|${parsed.subject || ''}|${parsed.date?.toISOString?.() || ''}|${String(parsed.text || '').length}`)
      .digest('hex');
  const headersObj = {};
  if (parsed.headers && typeof parsed.headers.entries === 'function') {
    for (const [k, v] of parsed.headers.entries()) {
      if (Object.keys(headersObj).length >= 60) break;
      const key = String(k).toLowerCase();
      if (typeof v === 'object' && v !== null && 'value' in v) {
        let s = String(v.value);
        if (v.params && typeof v.params === 'object') {
          s += '; ' + Object.entries(v.params).map(([pk, pv]) => `${pk}="${pv}"`).join('; ');
        }
        headersObj[key] = s.slice(0, 2000);
      } else if (Array.isArray(v)) {
        headersObj[key] = v.map(String).join(', ').slice(0, 2000);
      } else {
        headersObj[key] = String(v).slice(0, 2000);
      }
    }
  }
  return {
    messageId,
    inReplyTo: threading.normalizeMessageId(headerValue(parsed.headers, 'in-reply-to')),
    references: threading.parseReferences(headerValue(parsed.headers, 'references')),
    fromEmail: (parsed.from?.value?.[0]?.address || '').toLowerCase(),
    fromName: parsed.from?.value?.[0]?.name || '',
    toEmails: addrList(parsed.to?.value).map((a) => a.email),
    ccEmails: addrList(parsed.cc?.value).map((a) => a.email),
    bccEmails: [],
    subject: String(parsed.subject || '').slice(0, 500),
    textBody: String(parsed.text || '').slice(0, 200000),
    htmlBody: parsed.html ? sanitizeHtml(String(parsed.html)) : null,
    snippet: String((parsed.text || '').replace(/\s+/g, ' ').trim()).slice(0, 255),
    date: parsed.date ? new Date(parsed.date) : new Date(),
    headers: headersObj,
    attachments: (parsed.attachments || []).map((a) => ({
      filename: String(a.filename || 'attachment').slice(0, 255),
      contentType: a.contentType || 'application/octet-stream',
      size: a.size || 0,
    })),
  };
}

// ---------------------------------------------------------------------------
// Campaign attribution via message-id evidence
// ---------------------------------------------------------------------------
async function attributeCampaign(organizationId, { references, inReplyTo, fromEmail }, transaction) {
  const ids = [...(references || []), inReplyTo].map((s) => threading.normalizeMessageId(s)).filter(Boolean);
  if (!ids.length) return null;
  // Outbound jobs store the raw RFC id (with angle brackets); compare both forms.
  const bothForms = [...new Set([...ids, ...ids.map((id) => `<${id}>`)])];
  const job = await models.EmailJob.findOne({
    where: { organizationId, messageId: { [Op.in]: bothForms } },
    attributes: ['campaignId', 'stepId', 'campaignRecipientId'],
    transaction,
  });
  if (!job) return null;
  let recipientEmail = null;
  if (job.campaignRecipientId) {
    const recipient = await models.CampaignLead.findOne({
      where: { id: job.campaignRecipientId, organizationId },
      attributes: ['email'],
      transaction,
    });
    recipientEmail = recipient?.email || null;
  }
  const campaign = job.campaignId ? await models.Campaign.findOne({ where: { id: job.campaignId, organizationId }, transaction }) : null;
  return campaign ? { campaignId: campaign.id, sequenceId: null, sequenceStepId: job.stepId || null, recipientEmail } : null;
}

/** Stop future steps for the attributed campaign recipient (transactional caller). */
async function stopCampaignRecipientForReply({ organizationId, campaignId, email, messageType }, transaction) {
  if (messageType !== 'HUMAN_REPLY') return { stopped: 0 };
  if (!campaignId) return { stopped: 0 };
  const [recipient] = await models.CampaignLead.findAll({
    where: { organizationId, campaignId, email: String(email || '').toLowerCase() },
    attributes: ['id', 'status'],
    limit: 1,
    transaction,
  });
  if (!recipient) return { stopped: 0 };
  if (recipient.status === 'replied') return { stopped: 0, already: true };
  await models.EmailJob.destroy({ where: { campaignRecipientId: recipient.id, status: 'queued' }, transaction });
  await models.CampaignLead.update({ status: 'replied', repliedAt: new Date() }, { where: { id: recipient.id }, transaction });
  await models.EmailEvent.create({
    organizationId, campaignId, campaignRecipientId: recipient.id, eventType: 'REPLIED',
  }, { transaction });
  return { stopped: 1, recipientId: recipient.id };
}

/** Hard bounce / unsubscribe → suppression (transactional caller). */
async function applySuppression({ organizationId, email, reason }, transaction) {
  const [row] = await models.Suppression.findOrCreate({
    where: { organizationId, email: String(email || '').toLowerCase() },
    defaults: { organizationId, email: String(email || '').toLowerCase(), reason, source: 'inbox_sync' },
    transaction,
  });
  return { created: !!row };
}

/** HUMAN_REPLY → notifications for assignee, else all privileged org members. */
async function notifyInboundReply({ organizationId, conversation, fromEmail, fromName, subject, snippet }, transaction) {
  let userIds = [];
  if (conversation.assignedUserId) {
    userIds = [conversation.assignedUserId];
  } else {
    const members = await models.OrganizationMembership.findAll({
      where: { organizationId, isActive: true, role: { [Op.in]: ['owner', 'admin'] } },
      attributes: ['userId'],
      transaction,
    });
    userIds = members.map((m) => m.userId);
  }
  for (const userId of userIds) {
    await models.Notification.create({
      organizationId,
      userId,
      type: 'inbound_reply',
      title: `${fromName || fromEmail} replied`,
      body: `${subject || '(no subject)'} — ${snippet || ''}`.slice(0, 1000),
      conversationId: conversation.id,
    }, { transaction });
  }
}

function emitInboxMessage(organizationId, payload) {
  try {
    const rt = require('./realtime');
    if (rt?.io) rt.io.to(`org:${organizationId}`).emit('inbox:message', payload);
  } catch { /* realtime not initialized (tests) */ }
}

// ---------------------------------------------------------------------------
// Ingest one parsed message (idempotent)
// ---------------------------------------------------------------------------
async function ingestMessage(organizationId, account, parsed, { uid, receivedAt, raw } = {}) {
  return sequelize.transaction(async (t) => {
    // 1) Idempotency — the database already knows this message?
    const existing = await models.EmailMessage.findOne({
      where: { organizationId, messageId: parsed.messageId },
      attributes: ['id', 'conversationId'],
      transaction: t,
    });
    if (existing) return { duplicate: true, messageId: parsed.messageId };

    // 1b) The truly-affected mailbox for bounce messages (raw DSN payload)
    const finalRecipient = extractFinalRecipient(raw);

    // 2) Lead association (lowercase match) — for bounces, the DSN's reported recipient
    const leadEmail = finalRecipient || parsed.fromEmail;
    const lead = leadEmail
      ? await models.Lead.findOne({ where: { organizationId, email: leadEmail }, transaction: t })
      : null;

    // 3) Classification — deterministic
    const cls = classifier.classify({
      subject: parsed.subject,
      from: parsed.fromEmail,
      headers: parsed.headers,
      textBody: parsed.textBody,
      htmlBody: parsed.htmlBody || '',
    });

    // 4) Threading (transaction-scoped)
    const thread = await threading.matchThread({
      organizationId,
      sendingAccountId: account.id,
      fromEmail: parsed.fromEmail,
      subject: parsed.subject,
      inReplyTo: parsed.inReplyTo,
      references: parsed.references,
    }, t);

    // 5) Campaign attribution (thread evidence only)
    const attribution = await attributeCampaign(organizationId, parsed, t);

    // 6) Conversation — find or create
    let conversation = thread.conversation;
    if (conversation) {
      conversation = await models.Conversation.findOne({ where: { id: conversation.id }, transaction: t, lock: t.LOCK.UPDATE });
    } else {
      conversation = await models.Conversation.create({
        organizationId,
        subject: parsed.subject || '(no subject)',
        status: 'needs_reply',
        leadId: lead ? lead.id : null,
        campaignId: attribution?.campaignId || null,
        sequenceId: attribution?.sequenceId || null,
        sequenceStepId: attribution?.sequenceStepId || null,
        sendingAccountId: account.id,
        lastMessageAt: parsed.date,
        lastInboundAt: parsed.date,
        threadStatus: thread.matchStatus === 'needs_review' ? 'needs_review' : 'new',
      }, { transaction: t });
    }

    // 7) Persist the message
    const message = await models.EmailMessage.create({
      organizationId,
      conversationId: conversation.id,
      messageId: parsed.messageId,
      inReplyTo: parsed.inReplyTo || null,
      references: parsed.references || [],
      direction: 'inbound',
      fromEmail: parsed.fromEmail,
      fromName: parsed.fromName || parsed.fromEmail,
      toEmails: parsed.toEmails,
      ccEmails: parsed.ccEmails,
      subject: parsed.subject,
      textBody: parsed.textBody,
      htmlBody: parsed.htmlBody,
      snippet: parsed.snippet,
      headers: { ...parsed.headers,
        classification: cls.type,
        classification_signals: cls.signals,
        attachments: parsed.attachments,
        match_via: thread.matchedVia || null,
      },
      sentAt: parsed.date,
      receivedAt: receivedAt || parsed.date,
      status: 'received',
      isRead: false,
      messageType: cls.type,
      providerMessageId: parsed.messageId,
      mailboxUid: uid || null,
      providerName: 'imap',
      sendingAccountId: account.id,
      leadId: lead ? lead.id : null,
      campaignId: attribution?.campaignId || conversation.campaignId || null,
      sequenceId: attribution?.sequenceId || conversation.sequenceId || null,
      sequenceStepId: attribution?.sequenceStepId || conversation.sequenceStepId || null,
    }, { transaction: t });

    // 8) Update conversation timestamps / status
    const updates = { lastMessageAt: parsed.date, lastInboundAt: parsed.date };
    const isHuman = cls.type === 'HUMAN_REPLY';
    if (isHuman) {
      updates.status = 'needs_reply';
      updates.isArchived = false; // new human activity surfaces the thread
    } else if (conversation.isArchived) {
      // auto replies/system messages do not unarchive
    } else if (conversation.status === 'closed') {
      updates.status = 'needs_reply'; // a new human-ish signal reopens
    }
    await conversation.update(updates, { transaction: t });

    // 9) Campaign stopping / suppression / lead status (same transaction)
    const campaignId = attribution?.campaignId || conversation.campaignId || null;
    const stop = await stopCampaignRecipientForReply({ organizationId, campaignId, email: parsed.fromEmail, messageType: cls.type }, t);
    const unsubscribe = cls.unsubscribe || classifier.containsUnsubscribe(parsed.textBody);
    // Bounce suppression targets the bounced mailbox, not the mailer-daemon
    const bounceRecipient = finalRecipient || attribution?.recipientEmail || parsed.fromEmail;
    let suppressed = null;
    if (cls.bounceSeverity === 'hard') {
      suppressed = await applySuppression({ organizationId, email: bounceRecipient, reason: 'bounced' }, t);
      const bounceLead = lead && lead.email === bounceRecipient
        ? lead
        : await models.Lead.findOne({ where: { organizationId, email: bounceRecipient }, transaction: t });
      if (bounceLead) await bounceLead.update({ status: 'invalid', emailStatus: 'bounced' }, { transaction: t });
      if (campaignId) {
        await models.CampaignLead.update({ status: 'bounced', bouncedAt: new Date() }, { where: { organizationId, campaignId, email: bounceRecipient }, transaction: t });
      }
    } else if (unsubscribe) {
      suppressed = await applySuppression({ organizationId, email: parsed.fromEmail, reason: 'unsubscribed' }, t);
      if (lead) await lead.update({ status: 'unsubscribed' }, { transaction: t });
      if (campaignId) {
        await models.CampaignLead.update({ status: 'unsubscribed', unsubscribedAt: new Date() }, { where: { organizationId, campaignId, email: parsed.fromEmail }, transaction: t });
      }
    } else if (isHuman && lead && lead.status !== 'bounced' && lead.status !== 'unsubscribed') {
      await lead.update({ status: 'replied' }, { transaction: t });
    }

    // 10) Notifications on human replies only
    if (isHuman) {
      await notifyInboundReply({
        organizationId,
        conversation: { ...conversation.get({ plain: true }), assignedUserId: conversation.assignedUserId },
        fromEmail: parsed.fromEmail,
        fromName: parsed.fromName,
        subject: parsed.subject,
        snippet: parsed.snippet,
      }, t);
    }

    // 11) Audit + realtime
    await audit(organizationId, null, 'inbox_message_ingested', 'email_message', message.id, {
      conversationId: conversation.id, messageType: cls.type, matchStatus: thread.matchStatus,
      campaignId, fromDomain: String(parsed.fromEmail).split('@')[1] || '',
    });
    emitInboxMessage(organizationId, { conversationId: conversation.id, messageId: message.id, unread: true });

    return { duplicate: false, conversationId: conversation.id, messageId: message.id, classification: cls.type, stopped: stop.stopped, suppressed: !!suppressed };
  });
}

// ---------------------------------------------------------------------------
// IMAP fetcher (real) — injectable for tests
// ---------------------------------------------------------------------------
async function fetchImapMessages(account, state, onMessage) {
  const password = account.imapPasswordEncrypted ? decryptSecret(account.imapPasswordEncrypted) : null;
  const host = account.imapHost;
  const port = account.imapPort || 993;
  const secure = account.imapSecure !== false;
  if (!host || !account.imapUsername || !password) {
    const e = new Error('IMAP not configured for this account');
    e.code = 'not_configured';
    throw e;
  }
  const client = new ImapFlow({
    host, port, secure,
    auth: { user: account.imapUsername, pass: password },
    logger: false,
    emitLogs: false,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
  await client.connect();
  try {
    const box = await client.getMailboxLock('INBOX');
    try {
      const uidValidity = Number(client.mailbox?.uidValidity || 0);
      let lastUid = Number(state?.lastUid || 0);
      if (state?.uidValidity && Number(state.uidValidity) !== uidValidity) lastUid = 0; // UIDVALIDITY changed → rescan
      const range = lastUid > 0 ? `${lastUid + 1}:*` : '1:*';
      let processed = 0;
      let highestUid = lastUid;
      for await (const msg of client.fetch({ uid: range }, { uid: true, source: true, internalDate: true })) {
        if (processed >= MAX_MESSAGES_PER_TICK) break;
        if (!msg?.source) continue;
        await onMessage({ uid: msg.uid, internalDate: msg.internalDate, source: msg.source });
        highestUid = Math.max(highestUid, Number(msg.uid || 0));
        processed++;
      }
      return { uidValidity, lastUid: highestUid, processed };
    } finally {
      box.release();
    }
  } finally {
    try { await client.logout(); } catch { /* connection already closed */ }
  }
}

// ---------------------------------------------------------------------------
// Sync a single account — updates MailboxSyncState; per-message idempotent
// ---------------------------------------------------------------------------
async function syncAccount(account, { fetchMessages = fetchImapMessages, now = () => new Date() } = {}) {
  const organizationId = account.organizationId;
  const [state] = await models.MailboxSyncState.findOrCreate({
    where: { organizationId, sendingAccountId: account.id },
    defaults: { organizationId, sendingAccountId: account.id, provider: 'imap', status: 'idle' },
  });
  if (state.status === 'syncing') return { skipped: true, reason: 'already_syncing' };

  const started = now();
  await state.update({ status: 'syncing', lastSyncAt: started, errorCode: null, errorMessage: null });
  let learnedUidValidity = state.uidValidity ?? null;
  try {
    const result = await fetchMessages(account, state.get({ plain: true }), async ({ uid, source, internalDate }) => {
      const parsed = await parseRawMessage(source);
      // Advance the cursor only after the message is safely persisted.
      await ingestMessage(organizationId, account, parsed, { uid, receivedAt: internalDate ? new Date(internalDate) : new Date(), raw: source });
      const newUid = Math.max(Number(state.lastUid || 0), Number(uid || 0));
      state.lastUid = newUid;
      await state.update({ lastUid: newUid }).catch(() => {});
    });
    if (result?.uidValidity) learnedUidValidity = result.uidValidity;
    await state.update({
      status: 'idle',
      lastSuccessfulSyncAt: now(),
      consecutiveFailures: 0,
      uidValidity: learnedUidValidity,
      lastUid: Math.max(Number(state.lastUid || 0), Number(result?.lastUid || 0)),
    });
    return { ok: true, processed: result?.processed ?? 0 };
  } catch (error) {
    const isAuth = /auth|credential|login|password|authenticationfailed/i.test(String(error?.message || error)) || error?.code === 'auth_failed' || error?.serverResponseCode === 'AUTHENTICATIONFAILED';
    const code = error?.code || (isAuth ? 'auth_failed' : 'sync_error');
    const msg = String(error?.message || 'Sync failed').replace(/[\r\n]/g, ' ').slice(0, 450);
    await state.update({
      status: isAuth ? 'auth_failed' : 'error',
      errorCode: isAuth ? 'auth_failed' : 'sync_error',
      errorMessage: msg,
      consecutiveFailures: Number(state.consecutiveFailures || 0) + 1,
    }).catch(() => {});
    return { ok: false, code, error: msg };
  }
}

/** Sync every IMAP-enabled account in the org (worker entry point). */
async function syncAllAccounts(organizationId, opts = {}) {
  const accounts = await models.SmtpAccount.findAll({
    where: { organizationId, imapEnabled: true },
    order: [['name', 'ASC']],
  });
  const results = [];
  for (const account of accounts) {
    try {
      results.push({ accountId: account.id, ...(await syncAccount(account, opts)) });
    } catch (e) {
      results.push({ accountId: account.id, ok: false, code: 'unexpected', error: String(e?.message || e).slice(0, 200) });
    }
  }
  return results;
}

module.exports = {
  syncAccount,
  syncAllAccounts,
  ingestMessage,
  parseRawMessage,
  fetchImapMessages,
  _internals: { attributeCampaign, stopCampaignRecipientForReply, applySuppression, notifyInboundReply },
};
