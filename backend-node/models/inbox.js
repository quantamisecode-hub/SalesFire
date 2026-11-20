// Unified Inbox models — Conversation is the top-level org entity; a conversation
// is NOT owned by a campaign. Campaign attribution is nullable context established
// only by message-thread evidence (see services/conversation-threading.js).
// All models are org-scoped. HTML bodies are stored sanitized (see services/email.js).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

const CONVERSATION_STATUSES = ['open', 'needs_reply', 'waiting_for_reply', 'closed', 'archived', 'snoozed'];
const THREAD_STATUSES = ['matched', 'new', 'needs_review'];
const MESSAGE_DIRECTIONS = ['inbound', 'outbound'];
const MESSAGE_TYPES = ['HUMAN_REPLY', 'AUTO_REPLY', 'BOUNCE', 'OUT_OF_OFFICE', 'SYSTEM_MESSAGE', 'UNKNOWN'];
const MESSAGE_STATUSES = ['received', 'queued', 'sent', 'failed'];

class Conversation extends Model {
  static associate(models) {
    this.hasMany(models.EmailMessage, { as: 'messages', foreignKey: 'conversationId' });
    this.belongsTo(models.Lead, { as: 'lead', foreignKey: 'leadId' });
    this.belongsTo(models.Campaign, { as: 'campaign', foreignKey: 'campaignId' });
    this.belongsTo(models.CampaignSequence, { as: 'sequence', foreignKey: 'sequenceId' });
    this.belongsTo(models.SmtpAccount, { as: 'sendingAccount', foreignKey: 'sendingAccountId', onDelete: 'SET NULL' });
    this.belongsTo(models.User, { as: 'assignee', foreignKey: 'assignedUserId' });
    this.hasMany(models.ConversationInsight, { as: 'insights', foreignKey: 'conversationId' });
    this.hasMany(models.ConversationDraft, { as: 'drafts', foreignKey: 'conversationId' });
  }
}

Conversation.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  organizationId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'organization_id',
  },
  subject: { type: DataTypes.STRING(500), allowNull: false, defaultValue: '(no subject)' },
  status: {
    type: DataTypes.STRING(30),
    allowNull: false,
    defaultValue: 'open',
    validate: { isIn: [[...CONVERSATION_STATUSES]] },
  },
  // Lead context — nullable; a conversation must persist even if the lead is deleted (SET NULL).
  leadId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'lead_id',
  },
  // Campaign context — nullable; established only by thread evidence, never by
  // "the contact exists in a campaign".
  campaignId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'campaign_id',
  },
  sequenceId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'sequence_id',
  },
  sequenceStepId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'sequence_step_id',
  },
  sendingAccountId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'sending_account_id',
  },
  assignedUserId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'assigned_user_id',
  },
  lastMessageAt: { type: DataTypes.DATE, field: 'last_message_at' },
  lastInboundAt: { type: DataTypes.DATE, field: 'last_inbound_at' },
  lastOutboundAt: { type: DataTypes.DATE, field: 'last_outbound_at' },
  isStarred: { type: DataTypes.BOOLEAN, defaultValue: false, field: 'is_starred' },
  isArchived: { type: DataTypes.BOOLEAN, defaultValue: false, field: 'is_archived' },
  snoozedUntil: { type: DataTypes.DATE, field: 'snoozed_until' },
  tags: { type: DataTypes.JSON, allowNull: true },
  // matched | new | needs_review — review flag for ambiguous threads (never silently merged).
  threadStatus: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'matched',
    field: 'thread_status',
    validate: { isIn: [[...THREAD_STATUSES]] },
  },
}, {
  sequelize,
  tableName: 'conversations',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['organization_id'] },
    { fields: ['organization_id', 'status'] },
    { fields: ['organization_id', 'assigned_user_id'] },
    { fields: ['organization_id', 'last_message_at'] },
    { fields: ['organization_id', 'campaign_id'] },
    { fields: ['organization_id', 'lead_id'] },
    { fields: ['organization_id', 'sending_account_id'] },
    { fields: ['organization_id', 'is_archived', 'last_message_at'] },
    { fields: ['organization_id', 'snoozed_until'] },
  ],
});

class EmailMessage extends Model {
  static associate(models) {
    this.belongsTo(models.Conversation, { as: 'conversation', foreignKey: 'conversationId' });
    this.belongsTo(models.Lead, { as: 'lead', foreignKey: 'leadId' });
    this.belongsTo(models.Campaign, { as: 'campaign', foreignKey: 'campaignId' });
    this.belongsTo(models.SmtpAccount, { as: 'sendingAccount', foreignKey: 'sendingAccountId', onDelete: 'SET NULL' });
  }
}

EmailMessage.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  organizationId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'organization_id',
  },
  conversationId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'conversation_id',
  },
  messageId: {
    type: DataTypes.STRING(500),
    allowNull: false,
    field: 'message_id',
  },
  inReplyTo: { type: DataTypes.STRING(500), field: 'in_reply_to' },
  references: { type: DataTypes.JSON, allowNull: true },
  direction: {
    type: DataTypes.STRING(10),
    allowNull: false,
    validate: { isIn: [[...MESSAGE_DIRECTIONS]] },
  },
  fromEmail: { type: DataTypes.STRING(255), field: 'from_email' },
  fromName: { type: DataTypes.STRING(255), field: 'from_name' },
  toEmails: { type: DataTypes.JSON, field: 'to_emails' },
  ccEmails: { type: DataTypes.JSON, field: 'cc_emails' },
  bccEmails: { type: DataTypes.JSON, field: 'bcc_emails' },
  subject: { type: DataTypes.STRING(500) },
  textBody: { type: DataTypes.TEXT, field: 'text_body' },
  htmlBody: { type: DataTypes.TEXT, field: 'html_body' },
  snippet: { type: DataTypes.STRING(255) },
  headers: { type: DataTypes.JSON, allowNull: true },
  sentAt: { type: DataTypes.DATE, field: 'sent_at' },
  receivedAt: { type: DataTypes.DATE, field: 'received_at' },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'received',
    validate: { isIn: [[...MESSAGE_STATUSES]] },
  },
  isRead: { type: DataTypes.BOOLEAN, defaultValue: false, field: 'is_read' },
  messageType: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'UNKNOWN',
    field: 'message_type',
    validate: { isIn: [[...MESSAGE_TYPES]] },
  },
  providerMessageId: { type: DataTypes.STRING(500), field: 'provider_message_id' },
  mailboxUid: { type: DataTypes.BIGINT, field: 'mailbox_uid' },
  sendingAccountId: { type: DataTypes.UUID, field: 'sending_account_id' },
  leadId: { type: DataTypes.UUID, field: 'lead_id' },
  campaignId: { type: DataTypes.UUID, field: 'campaign_id' },
  sequenceId: { type: DataTypes.UUID, field: 'sequence_id' },
  sequenceStepId: { type: DataTypes.UUID, field: 'sequence_step_id' },
  providerName: { type: DataTypes.STRING(20), defaultValue: 'imap', field: 'provider_name' },
  // Set on outbound replies for double-send protection (conversation-unique per send attempt).
  idempotencyKey: { type: DataTypes.STRING(255), field: 'idempotency_key', unique: true },
}, {
  sequelize,
  tableName: 'email_messages',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['organization_id', 'message_id'], unique: true, name: 'uq_email_messages_org_message_id' },
    { fields: ['conversation_id', 'created_at'] },
    { fields: ['conversation_id', 'is_read'] },
    { fields: ['organization_id', 'campaign_id'] },
    { fields: ['organization_id', 'lead_id'] },
    { fields: ['organization_id', 'sending_account_id'] },
    { fields: ['organization_id', 'received_at'] },
  ],
});

class MailboxSyncState extends Model {
  static associate(models) {
    this.belongsTo(models.SmtpAccount, { as: 'account', foreignKey: 'sendingAccountId', onDelete: 'CASCADE' });
  }
}

MailboxSyncState.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  organizationId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'organization_id',
  },
  sendingAccountId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'sending_account_id',
    unique: true,
  },
  provider: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'imap' },
  lastUid: { type: DataTypes.BIGINT, field: 'last_uid' },
  // If the server reports UIDVALIDITY ≠ stored value, the cursor resets.
  uidValidity: { type: DataTypes.BIGINT, field: 'uid_validity' },
  lastSyncAt: { type: DataTypes.DATE, field: 'last_sync_at' },
  lastSuccessfulSyncAt: { type: DataTypes.DATE, field: 'last_successful_sync_at' },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'idle', // idle | syncing | error | auth_failed | disabled
  },
  errorCode: { type: DataTypes.STRING(60), field: 'error_code' },
  errorMessage: { type: DataTypes.STRING(500), field: 'error_message' },
  consecutiveFailures: { type: DataTypes.INTEGER, defaultValue: 0, field: 'consecutive_failures' },
}, {
  sequelize,
  tableName: 'mailbox_sync_states',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['organization_id'] },
    { fields: ['organization_id', 'sending_account_id'], unique: true, name: 'uq_mailbox_sync_org_account' },
  ],
});

class ConversationDraft extends Model {
  static associate(models) {
    this.belongsTo(models.Conversation, { as: 'conversation', foreignKey: 'conversationId' });
    this.belongsTo(models.User, { as: 'user', foreignKey: 'userId' });
  }
}

ConversationDraft.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  organizationId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'organization_id',
  },
  conversationId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'conversation_id',
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'user_id',
  },
  toEmails: { type: DataTypes.JSON, field: 'to_emails' },
  ccEmails: { type: DataTypes.JSON, field: 'cc_emails' },
  bccEmails: { type: DataTypes.JSON, field: 'bcc_emails' },
  subject: { type: DataTypes.STRING(500) },
  textBody: { type: DataTypes.TEXT, field: 'text_body' },
  htmlBody: { type: DataTypes.TEXT, field: 'html_body' },
  sendingAccountId: { type: DataTypes.UUID, field: 'sending_account_id' },
  signatureId: { type: DataTypes.UUID, field: 'signature_id' },
}, {
  sequelize,
  tableName: 'conversation_drafts',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['organization_id'] },
    { fields: ['conversation_id', 'user_id'], unique: true, name: 'uq_draft_conversation_user' },
  ],
});

class ConversationInsight extends Model {
  static associate(models) {
    this.belongsTo(models.Conversation, { as: 'conversation', foreignKey: 'conversationId' });
    this.belongsTo(models.EmailMessage, { as: 'sourceMessage', foreignKey: 'sourceMessageId' });
  }
}

ConversationInsight.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  organizationId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'organization_id',
  },
  conversationId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'conversation_id',
  },
  type: {
    type: DataTypes.STRING(30),
    allowNull: false, // summary | buying_signal | objection | intent
  },
  value: { type: DataTypes.TEXT, allowNull: false },
  confidence: { type: DataTypes.FLOAT, defaultValue: 0.5 },
  sourceMessageId: { type: DataTypes.UUID, field: 'source_message_id' },
  model: { type: DataTypes.STRING(120) },
}, {
  sequelize,
  tableName: 'conversation_insights',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['organization_id'] },
    { fields: ['conversation_id', 'created_at'] },
  ],
});

class Notification extends Model {
  static associate(models) {
    this.belongsTo(models.Conversation, { as: 'conversation', foreignKey: 'conversationId' });
  }
}

Notification.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  organizationId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'organization_id',
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'user_id',
  },
  type: {
    type: DataTypes.STRING(40),
    allowNull: false, // inbound_reply | sync_failure | system
  },
  title: { type: DataTypes.STRING(255), allowNull: false },
  body: { type: DataTypes.STRING(1000) },
  conversationId: { type: DataTypes.UUID, field: 'conversation_id' },
  isRead: { type: DataTypes.BOOLEAN, defaultValue: false, field: 'is_read' },
}, {
  sequelize,
  tableName: 'notifications',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['organization_id', 'user_id', 'is_read'] },
    { fields: ['organization_id', 'created_at'] },
  ],
});

module.exports = {
  Conversation,
  EmailMessage,
  MailboxSyncState,
  ConversationDraft,
  ConversationInsight,
  Notification,
  CONVERSATION_STATUSES,
  MESSAGE_TYPES,
  THREAD_STATUSES,
};
