// EmailEvent Model - append-only per-email event log (Prompt 6 §25).
// Events: QUEUED, SENDING, SENT, DELIVERED, BOUNCED, FAILED, REPLIED, UNSUBSCRIBED
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class EmailEvent extends Model {
  static associate(models) {
    this.belongsTo(models.Campaign, { as: 'campaign', foreignKey: 'campaignId' });
    this.belongsTo(models.Organization, { as: 'organization', foreignKey: 'organizationId' });
    this.belongsTo(models.CampaignLead, { as: 'recipient', foreignKey: 'campaignRecipientId' });
  }
}

EmailEvent.init({
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
  campaignId: {
    type: DataTypes.UUID,
    field: 'campaign_id',
  },
  campaignRecipientId: {
    type: DataTypes.UUID,
    field: 'campaign_recipient_id',
  },
  emailJobId: {
    type: DataTypes.UUID,
    field: 'email_job_id',
  },
  messageId: {
    type: DataTypes.STRING(500),
    field: 'message_id',
  },
  // QUEUED | SENDING | SENT | DELIVERED | BOUNCED | FAILED | REPLIED | UNSUBSCRIBED
  eventType: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'event_type',
  },
  eventTimestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'event_timestamp',
  },
  providerEventId: {
    type: DataTypes.STRING(255),
    field: 'provider_event_id',
  },
  metadata: {
    type: DataTypes.JSON,
  },
  // PROMPT 9.1 — account attribution (no secrets; ids only).
  sendingAccountId: {
    type: DataTypes.UUID,
    field: 'sending_account_id',
  },
  sequenceStepId: {
    type: DataTypes.UUID,
    field: 'sequence_step_id',
  },
  variantId: {
    type: DataTypes.UUID,
    field: 'variant_id',
  },
}, {
  sequelize,
  tableName: 'email_events',
  timestamps: true,
  updatedAt: false,
  underscored: true,
});

module.exports = EmailEvent;
