// QA seed for the Unified Inbox mailbox redesign.
// Creates clearly-marked test conversations/messages for org
// SalesFire Demo (94cca164-951d-4e76-94b0-ad42778ed7ae) so the mailbox
// folders, counts, email cards and sorting can be verified in the browser.
// Idempotent-ish: skips if a conversation with subject prefix [QA] exists.
// Run: node scripts/seed-inbox-qa.js
const { sequelize } = require('../db');
const models = require('../models');
const { v4: uuid } = require('uuid');

const ORG = '94cca164-951d-4e76-94b0-ad42778ed7ae';
const PREFIX = '[QA]';

async function main() {
  await sequelize.sync();
  const { Conversation, EmailMessage, Lead, Campaign, SmtpAccount } = models;

  const existing = await Conversation.count({
    where: { organizationId: ORG, subject: { [require('sequelize').Op.like]: `${PREFIX}%` } },
  });
  if (existing > 0) {
    console.log(`Already seeded (${existing} [QA] conversations). Nothing to do.`);
    await sequelize.close();
    return;
  }

  const owner = await models.User.findOne({ where: { email: 'admin@salesfire.dev' } });
  if (!owner) throw new Error('Demo admin not found — register admin@salesfire.dev first.');

  const now = Date.now();
  const iso = (offsetMin) => new Date(now + offsetMin * 60000).toISOString();

  // Minimal supporting records (marked [QA]) — reuse on re-run (the script
  // may have failed partway on a previous attempt).
  const lead = await Lead.findOne({ where: { organizationId: ORG, email: 'qa.prospect@example.test' } })
    || await Lead.create({
      organizationId: ORG, firstName: 'QA', lastName: 'Prospect',
      email: 'qa.prospect@example.test', companyName: 'QA Test Co',
      jobTitle: 'Head of Testing', status: 'replied',
    });
  const campaign = await Campaign.findOne({ where: { organizationId: ORG, name: '[QA] Mailbox Test Campaign' } })
    || await Campaign.create({
      organizationId: ORG, name: '[QA] Mailbox Test Campaign', status: 'active',
      createdBy: owner.id,
    });
  const account = await SmtpAccount.findOne({ where: { organizationId: ORG, name: '[QA] QA Mailbox' } })
    || await SmtpAccount.create({
      organizationId: ORG, name: '[QA] QA Mailbox', smtpHost: 'smtp.example.test',
      smtpPort: 587, security: 'starttls', smtpUsername: 'qa@example.test',
      smtpPasswordEncrypted: 'x', fromEmail: 'qa@example.test', fromName: 'QA Mailbox',
      createdBy: owner.id, imapEnabled: false,
    });

  const mkConv = async (subject, over = {}) => Conversation.create({
    organizationId: ORG, subject: `${PREFIX} ${subject}`,
    status: 'needs_reply', leadId: lead.id, campaignId: campaign.id,
    sendingAccountId: account.id, lastMessageAt: iso(0), ...over,
  });

  const mkMsg = async (conv, over = {}) => EmailMessage.create({
    organizationId: ORG, conversationId: conv.id,
    messageId: `<${uuid()}@qa.test>`, direction: 'inbound',
    fromEmail: 'qa.prospect@example.test', fromName: 'QA Prospect',
    toEmails: ['qa@example.test'], subject: conv.subject,
    textBody: 'This is a QA test message body.', snippet: 'This is a QA test message body.',
    receivedAt: iso(0), status: 'received', isRead: true, messageType: 'HUMAN_REPLY',
    ...over,
  });

  // 1. Inbox + unread (needs_reply)
  const c1 = await mkConv('Unread reply needing response', { status: 'needs_reply' });
  await mkMsg(c1, { direction: 'outbound', fromEmail: 'qa@example.test', fromName: null,
    toEmails: ['qa.prospect@example.test'], textBody: 'Original outreach (outbound).',
    snippet: 'Original outreach (outbound).', receivedAt: null, sentAt: iso(-120), isRead: true });
  await mkMsg(c1, { isRead: false, textBody: 'Yes — send me details on pricing!',
    snippet: 'Yes — send me details on pricing!' });

  // 2. Starred + sent (waiting_for_reply)
  const c2 = await mkConv('Starred thread, waiting on them', { status: 'waiting_for_reply', isStarred: true });
  await mkMsg(c2, { direction: 'outbound', fromEmail: 'qa@example.test',
    toEmails: ['qa.prospect@example.test'], textBody: 'Following up (outbound).',
    snippet: 'Following up (outbound).', receivedAt: null, sentAt: iso(-60) });

  // 3. Archived
  const c3 = await mkConv('Archived old thread', { status: 'closed', isArchived: true });
  await mkMsg(c3, { textBody: 'Archived message.' });

  // 4. Snoozed (active)
  const c4 = await mkConv('Snoozed until tomorrow', { snoozedUntil: new Date(now + 24 * 3600 * 1000).toISOString() });
  await mkMsg(c4, { textBody: 'Snoozed message.' });

  // 5. Assigned to me (mine + assigned)
  const c5 = await mkConv('Assigned to admin', { status: 'open', assignedUserId: owner.id });
  await mkMsg(c5, { textBody: 'Assigned thread message.' });

  // 6. Closed (also in Inbox/all)
  await mkConv('Closed conversation', { status: 'closed' });

  console.log('Seeded QA conversations:');
  for (const c of await Conversation.findAll({ where: { organizationId: ORG, subject: { [require('sequelize').Op.like]: `${PREFIX}%` } } })) {
    console.log(` - ${c.id}  ${c.subject}`);
  }
  await sequelize.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
