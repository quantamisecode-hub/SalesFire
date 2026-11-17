// EmailJob Model - the durable send queue (Prompt 6 §33).
// One job = one recipient × one sequence step. The worker claims jobs
// atomically (status queued -> sending in a guarded UPDATE) so two workers
// can never send the same job twice (Prompt 6 §34).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class EmailJob extends Model {
  static associate(models) {
    this.belongsTo(models.Campaign, { as: 'campaign', foreignKey: 'campaignId' });
    this.belongsTo(models.Organization, { as: 'organization', foreignKey: 'organizationId' });
    this.belongsTo(models.CampaignLead, { as: 'recipient', foreignKey: 'campaignRecipientId' });
    this.belongsTo(models.CampaignStep, { as: 'step', foreignKey: 'stepId' });
  }
}

EmailJob.init({
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
    allowNull: false,
    field: 'campaign_id',
  },
  campaignRecipientId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'campaign_recipient_id',
  },
  stepId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'step_id',
  },
  // queued | sending | sent | failed | cancelled | suppressed
  status: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'queued',
  },
  attempts: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  maxAttempts: {
    type: DataTypes.INTEGER,
    defaultValue: 3,
    field: 'max_attempts',
  },
  // Hard failure is permanent; soft failures retry with backoff.
  failureClass: {
    type: DataTypes.STRING(50),
    field: 'failure_class',
  },
  lastError: {
    type: DataTypes.TEXT,
    field: 'last_error',
  },
  scheduledFor: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'scheduled_for',
  },
  claimedAt: {
    type: DataTypes.DATE,
    field: 'claimed_at',
  },
  claimedBy: {
    type: DataTypes.STRING(100),
    field: 'claimed_by',
  },
  messageId: {
    type: DataTypes.STRING(500),
    field: 'message_id',
  },
  sentAt: {
    type: DataTypes.DATE,
    field: 'sent_at',
  },
}, {
  sequelize,
  tableName: 'email_jobs',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['status', 'scheduled_for'] },
  ],
});

module.exports = EmailJob;
