// ConversationThreadingService — match inbound mail to conversations.
//
// Ordered matching:
//   1. In-Reply-To / References  → high confidence (same org), match by stored Message-IDs
//   2. normalized subject + same sender pair on the same sending account → MEDIUM confidence,
//      and only when the subject is non-empty and not generic; otherwise NEW.
//   3. Weak match (references parsed but none of them resolve) → NEW conversation flagged
//      needs_review (never silently merged into the wrong thread).
//
// Subject normalization strips Re:/RE:/Fwd:/FW:/Resent: and leading [brackets], collapses
// whitespace, lowercases — for matching only; the original subject is always preserved.
const { Op } = require('sequelize');
const models = require('../models');

const MAX_REFERENCES = 40;

/** Normalize an RFC 5322 Message-ID: strip <>, trim, lowercase. */
function normalizeMessageId(id) {
  if (!id) return '';
  let s = String(id).trim();
  if (s.startsWith('<') && s.endsWith('>')) s = s.slice(1, -1);
  return s.trim().toLowerCase();
}

/** Parse a References header (may be one long string or an array) into unique normalized ids. */
function parseReferences(refs) {
  if (!refs) return [];
  const raw = Array.isArray(refs) ? refs.join(' ') : String(refs);
  const found = raw.match(/<[^<>\s]+>/g) || raw.split(/\s+/g);
  const ids = [];
  for (const token of found) {
    const id = normalizeMessageId(token);
    if (id && !ids.includes(id)) ids.push(id);
    if (ids.length >= MAX_REFERENCES) break;
  }
  return ids;
}

/** Normalize a subject for threading. Never used to store the display subject. */
function normalizeSubject(subject) {
  let s = String(subject || '');
  // Iteratively strip leading Re:/RE:/Fwd:/FW:/Resent: and [list tags]
  for (;;) {
    const before = s;
    s = s.replace(/^\s*(re|fw|fwd|resent)\s*:\s*/i, '');
    s = s.replace(/^\s*\[[^\]]{1,60}\]\s*/, '');
    if (s === before) break;
  }
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

const GENERIC_SUBJECTS = new Set(['', '(no subject)', 'no subject', 'hi', 'hello', 'hey', 'thanks', 'thank you', 'update']);

/**
 * Find or classify the thread for an inbound message.
 * Returns { conversation, matchStatus, matchedVia }:
 *   matchStatus: 'matched' | 'new' | 'needs_review' | 'external'
 *   matchedVia:  'in_reply_to' | 'references' | 'subject_pair' | null
 */
async function matchThread({ organizationId, sendingAccountId, fromEmail, subject, inReplyTo, references }, transaction) {
  const ids = [normalizeMessageId(inReplyTo), ...parseReferences(references)].filter(Boolean);
  // Outbound writes store raw RFC ids (with angle brackets); compare both forms.
  const bothForms = [...new Set([...ids, ...ids.map((id) => `<${id}>`)])];

  // 1) References / In-Reply-To against messages we already have (any direction)
  if (ids.length) {
    const hits = await models.EmailMessage.findAll({
      where: { organizationId, messageId: { [Op.in]: bothForms } },
      attributes: ['conversationId'],
      group: ['conversationId'],
      raw: true,
      transaction,
    });
    if (hits.length === 1) {
      const conv = await models.Conversation.findOne({ where: { id: hits[0].conversationId, organizationId }, transaction });
      if (conv) return { conversation: conv, matchStatus: 'matched', matchedVia: inReplyTo ? 'in_reply_to' : 'references' };
    }
    if (hits.length > 1) {
      // Ambiguous: prefer the conversation of the most recent referenced message
      // (closest ancestor in the thread), flagged needs_review for human triage.
      const recent = await models.EmailMessage.findOne({
        where: { organizationId, messageId: { [Op.in]: bothForms } },
        order: [['receivedAt', 'DESC']],
        attributes: ['conversationId'],
        transaction,
      });
      const conv = recent && await models.Conversation.findOne({ where: { id: recent.conversationId, organizationId }, transaction });
      if (conv) return { conversation: conv, matchStatus: 'needs_review', matchedVia: 'references' };
    }
  }

  // 2) Normalized subject + (sender → this account) pair match. Medium confidence:
  //    requires non-generic subject AND same pair on the same sending account.
  const norm = normalizeSubject(subject);
  if (norm && !GENERIC_SUBJECTS.has(norm) && fromEmail && sendingAccountId) {
    const candidate = await models.Conversation.findOne({
      where: {
        organizationId,
        sendingAccountId,
        subject: { [Op.like]: `%${norm.replace(/[%_\\]/g, (c) => `\\${c}`)}%` },
      },
      order: [['lastMessageAt', 'DESC']],
      transaction,
    });
    if (candidate) {
      // Confirm the sender pair: the conversation contains a message to/from this email.
      const pair = await models.EmailMessage.count({
        where: {
          conversationId: candidate.id,
          organizationId,
          [Op.or]: [
            { fromEmail: { [Op.like]: String(fromEmail).toLowerCase() } },
            { toEmails: { [Op.like]: `%${String(fromEmail).toLowerCase()}%` } },
          ],
        },
        transaction,
      });
      if (pair > 0) {
        return { conversation: candidate, matchStatus: 'matched', matchedVia: 'subject_pair' };
      }
    }
  }

  // 3) Weak reference (ids found but none resolve) → needs_review on a fresh conversation
  return { conversation: null, matchStatus: ids.length ? 'needs_review' : 'new', matchedVia: null };
}

module.exports = { normalizeMessageId, parseReferences, normalizeSubject, matchThread, GENERIC_SUBJECTS };
