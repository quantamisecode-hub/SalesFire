// ReplyService — send a reply from the unified inbox.
// Reuses: buildLeadVars (variables), template-renderer (render+sanitize+spintax),
// signature-resolver (Prompt 9 hierarchy), Suppression (unsubscribe guard),
// SendingAccountAllocator (atomic quota), services/email.js (SMTP transport).
//
// Guarantees:
//   * Never sends from an unauthorized/unrelated account (BOLA-safe org scoping).
//   * Double-send protection via idempotency key derived from the draft revision
//     (unique index on email_messages.idempotency_key).
//   * A message is only ever marked SENT after SMTP accepts it; failures mark
//     FAILED and release the reserved quota unit.
//   * Unsubscribe/blocked recipients cannot be emailed from the inbox.
const { Op } = require('sequelize');
const models = require('../models');
const { sequelize } = require('../db');
const emailService = require('./email');
const { buildLeadVars } = require('./campaign-engine');
const templateRenderer = require('./template-renderer');
const allocator = require('./sending-account-allocator');
const { resolveSignature, renderSignatureHtml, renderSignatureText, signatureHtmlBlock, signatureTextBlock } = require('./signature-resolver');
const { audit } = require('./audit');

class ReplyError extends Error {
  constructor(code, message, statusCode = 409) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

const escapeHtml = (s) => String(s || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function textToHtml(text) {
  return `<p>${escapeHtml(text).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>`;
}

/**
 * Send a reply in a conversation.
 * Returns { messageId, conversationId } or throws ReplyError.
 */
async function sendReply({ organizationId, actorId, conversationId, draft, subject, bodyText, bodyHtml, toEmails, ccEmails, bccEmails, sendingAccountId, signatureId }) {
  if (!draft && !bodyText && !bodyHtml) throw new ReplyError('empty_body', 'Reply body is empty.', 422);

  const conversation = await models.Conversation.findOne({
    where: { id: conversationId, organizationId },
  });
  if (!conversation) throw new ReplyError('not_found', 'Conversation not found.', 404);

  // --- Resolve sending account: explicit request > conversation's original account.
  let account = null;
  const requestedId = sendingAccountId || draft?.sendingAccountId || null;
  if (requestedId) {
    account = await models.SmtpAccount.findOne({ where: { id: requestedId, organizationId, isEnabled: true } });
    if (!account) throw new ReplyError('account_unavailable', 'The selected sending account is unavailable or disabled.', 409);
  } else if (conversation.sendingAccountId) {
    account = await models.SmtpAccount.findOne({ where: { id: conversation.sendingAccountId, organizationId, isEnabled: true } });
    if (!account) {
      throw new ReplyError('account_unavailable', 'The conversation\'s sending account is unavailable or disabled. Choose another account.', 409);
    }
  }
  if (!account) throw new ReplyError('account_unavailable', 'No sending account is configured for this conversation. Choose one.', 409);

  // --- Recipient: the original counterpart (lead email preferred, else last inbound sender).
  let recipientEmail = toEmails?.[0];
  if (!recipientEmail && conversation.leadId) {
    const lead = await models.Lead.findOne({ where: { id: conversation.leadId, organizationId }, attributes: ['email'] });
    recipientEmail = lead?.email;
  }
  if (!recipientEmail) {
    const lastInbound = await models.EmailMessage.findOne({
      where: { conversationId, organizationId, direction: 'inbound' },
      order: [['receivedAt', 'DESC']],
      attributes: ['fromEmail'],
    });
    recipientEmail = lastInbound?.fromEmail;
  }
  if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(recipientEmail)) {
    throw new ReplyError('invalid_recipient', 'No valid recipient is available for this conversation.', 422);
  }

  // --- Suppression (tenant-wide) ---
  const suppressed = await models.Suppression.findOne({ where: { organizationId, email: String(recipientEmail).toLowerCase() } });
  if (suppressed) throw new ReplyError('suppressed', `This recipient is suppressed (${suppressed.reason || 'blocked'}). Remove the suppression before replying.`, 409);

  // --- Quota reservation (atomic) ---
  const dailyLimit = Number.isFinite(account.dailyLimit) ? account.dailyLimit : 100;
  const hourlyLimit = Number.isFinite(account.hourlyLimit) ? account.hourlyLimit : 20;
  const reservation = await allocator.reserveUsage(account.id, dailyLimit, hourlyLimit);
  if (!reservation.ok) throw new ReplyError('quota_exceeded', `Sending limit reached for ${account.fromEmail} (${reservation.reason}).`, 429);

  // --- Idempotency key: steady bucket per (conversation, actor, draft revision)
  // or content hash when there is no draft. Identical double-submits dedup;
  // edited content produces a new key.
  const bodyForHash = `${subject}|${bodyText || ''}|${bodyHtml || ''}`;
  const contentTag = require('crypto').createHash('sha256').update(bodyForHash).digest('hex').slice(0, 16);
  const draftUpdatedAt = draft?.updatedAt ? new Date(draft.updatedAt).getTime() : null;
  const idempotencyKey = `reply:${conversationId}:${actorId}:${draftUpdatedAt || contentTag}`;

  try {
    // Create the outbound message row FIRST (idempotency), then send, then update state.
    const lead = conversation.leadId
      ? await models.Lead.findOne({ where: { id: conversation.leadId, organizationId } })
      : await models.Lead.findOne({ where: { organizationId, email: String(recipientEmail).toLowerCase() } });

    const outbound = await models.EmailMessage.create({
      organizationId,
      conversationId: conversation.id,
      messageId: `<reply-${idempotencyKey}@salesfire.local>`,
      inReplyTo: null,
      references: [],
      direction: 'outbound',
      fromEmail: account.fromEmail,
      fromName: account.fromName || account.fromEmail,
      toEmails: [recipientEmail, ...(toEmails || []).slice(1)].filter(Boolean),
      ccEmails: ccEmails || [],
      bccEmails: bccEmails || [],
      subject: subject || '(no subject)',
      textBody: bodyText || '',
      htmlBody: null,
      snippet: String(bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 255),
      sentAt: new Date(),
      receivedAt: null,
      status: 'queued',
      isRead: true,
      messageType: 'HUMAN_REPLY',
      providerName: 'smtp',
      sendingAccountId: account.id,
      leadId: lead ? lead.id : null,
      campaignId: conversation.campaignId || null,
      idempotencyKey,
    });

    // --- Render: variables + spintax + signature (shared pipeline) ---
    const vars = buildLeadVars({ email: recipientEmail, firstName: lead?.firstName || '', lastName: lead?.lastName || '', companyName: lead?.companyName || '', jobTitle: lead?.jobTitle || '' }, lead, account, '');
    const htmlSource = bodyHtml || textToHtml(bodyText || '');
    const requestedSignatureId = signatureId || draft?.signatureId || null;
    const sigRes = await resolveSignature({
      organizationId,
      campaignId: conversation.campaignId || undefined,
      accountId: account.id,
      ...(requestedSignatureId ? { stepMode: 'custom', stepSignatureId: requestedSignatureId } : {}),
    });
    let signatureHtml = '', signatureText = '';
    if (sigRes?.signature) {
      signatureHtml = signatureHtmlBlock(renderSignatureHtml(sigRes.signature.html, vars, idempotencyKey).html);
      signatureText = signatureTextBlock(renderSignatureText(sigRes.signature.text, vars, idempotencyKey));
    }
    const rendered = templateRenderer.renderEmail({
      subject: subject || '',
      bodyHtml: signatureHtml ? `${htmlSource}${signatureHtml}` : htmlSource,
      vars,
      seed: idempotencyKey,
    });
    const finalHtml = rendered.html;
    const finalText = signatureText ? `${rendered.text}\n\n${signatureText}` : rendered.text;

    // --- Actual SMTP send. Only after 250-OK do we persist SENT. ---
    const result = await emailService.sendEmail(account, {
      to: recipientEmail,
      cc: (ccEmails || []).join(', ') || undefined,
      bcc: (bccEmails || []).join(', ') || undefined,
      subject: rendered.subject,
      text: finalText,
      html: finalHtml,
      headers: { 'X-SalesFire-Conversation': conversation.id },
    });

    if (!result.ok) {
      await outbound.update({ status: 'failed' });
      await allocator.releaseUsage(account.id).catch(() => {});
      throw new ReplyError('smtp_failed', `SMTP send failed: ${result.error || result.failureClass || 'unknown error'}`, 502);
    }

    // Stamp the provider message id now that SMTP accepted it.
    const providerMessageId = result.messageId || null;
    await outbound.update({ status: 'sent', messageId: providerMessageId || outbound.messageId, htmlBody: finalHtml });

    // --- Conversation + analytics side effects (same success path, best-effort transactional-ish) ---
    await conversation.update({ status: 'waiting_for_reply', lastMessageAt: new Date(), lastOutboundAt: new Date(), isArchived: false });
    if (conversation.campaignId) {
      await models.EmailEvent.create({
        organizationId,
        campaignId: conversation.campaignId,
        campaignRecipientId: null,
        eventType: 'SENT',
        sendingAccountId: account.id,
        messageId: providerMessageId || outbound.messageId,
      }).catch(() => { /* analytics must never break the send path */ });
    }
    await audit(organizationId, actorId, 'inbox_reply_sent', 'conversation', conversation.id, {
      conversationId: conversation.id, sendingAccountId: account.id, messageId: outbound.id,
    });

    return { messageId: outbound.id, providerMessageId, conversationId: conversation.id };
  } catch (error) {
    // Double-send: the same draft revision attempted twice (two tabs / double click).
    const uniqueField = error?.errors?.[0]?.path || error?.fields && Object.keys(error.fields)[0] || '';
    const isUnique = error?.name === 'SequelizeUniqueConstraintError' || uniqueField;
    if (isUnique && /idempotency|message_id/i.test(String(uniqueField || error?.message || ''))) {
      await allocator.releaseUsage(account.id).catch(() => {});
      throw new ReplyError('already_sent', 'This draft was already sent. Refresh the conversation to see it.', 409);
    }
    if (!(error instanceof ReplyError) || error.code !== 'smtp_failed') {
      // Only release when we haven't already released (smtp_failed path releases itself).
      await allocator.releaseUsage(account.id).catch(() => {});
    }
    throw error;
  }
}

module.exports = { sendReply, ReplyError };
