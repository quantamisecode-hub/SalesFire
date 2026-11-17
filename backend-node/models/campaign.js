// Campaign Model - Prompt 5 AI Outreach & Campaign Engine
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class Campaign extends Model {
  static associate(models) {
    this.belongsTo(models.Organization, { as: 'organization' });
    this.belongsTo(models.User, { as: 'creator', foreignKey: 'createdBy' });
    this.hasMany(models.CampaignSequence, { as: 'sequel', foreignKey: 'campaignId', onDelete: 'CASCADE' });
    this.hasMany(models.CampaignSequence, { as: 'sequences', foreignKey: 'campaignId', onDelete: 'CASCADE' });
  }
}

// Initialize Campaign model
Campaign.init({
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
  createdBy: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'created_by',
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  status: {
    type: DataTypes.STRING(50),
    defaultValue: 'draft',
  },
  sendingAccountId: {
    type: DataTypes.UUID,
    field: 'sending_account_id',
  },
  // Signature resolution (Prompt 9): INHERIT | CUSTOM | NONE.
  signatureMode: {
    type: DataTypes.STRING(10),
    field: 'signature_mode',
    defaultValue: 'inherit',
  },
  signatureId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'signature_id',
  },
  aiPersonalizationDepth: {
    type: DataTypes.STRING(50),
    defaultValue: 'standard',
    field: 'ai_personalization_depth',
  },
  hourlyLimit: {
    type: DataTypes.INTEGER,
    field: 'hourly_limit',
  },
  minDelayMinutes: {
    type: DataTypes.INTEGER,
    field: 'min_delay_minutes',
  },
  maxDelayMinutes: {
    type: DataTypes.INTEGER,
    field: 'max_delay_minutes',
  },
  totalFailed: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    field: 'total_failed',
  },
  archivedAt: {
    type: DataTypes.DATE,
    field: 'archived_at',
  },
  campaignType: {
    type: DataTypes.STRING(50),
    defaultValue: 'outreach',
  },
  scheduledStartAt: {
    type: DataTypes.DATE,
    field: 'scheduled_start_at',
  },
  scheduledEndAt: {
    type: DataTypes.DATE,
    field: 'scheduled_end_at',
  },
  startedAt: {
    type: DataTypes.DATE,
    field: 'started_at',
  },
  completedAt: {
    type: DataTypes.DATE,
    field: 'completed_at',
  },
  pausedAt: {
    type: DataTypes.DATE,
    field: 'paused_at',
  },
  cancelledAt: {
    type: DataTypes.DATE,
    field: 'cancelled_at',
  },
  maxEmailsPerDay: {
    type: DataTypes.INTEGER,
  },
  maxEmailsPerLead: {
    type: DataTypes.INTEGER,
    defaultValue: 10,
  },
  sendBetweenStartHour: {
    type: DataTypes.INTEGER,
  },
  sendBetweenEndHour: {
    type: DataTypes.INTEGER,
  },
  sendDaysOfWeek: {
    type: DataTypes.JSON,
  },
  timezone: {
    type: DataTypes.STRING(50),
    defaultValue: 'UTC',
  },
  aiProvider: {
    type: DataTypes.STRING(50),
    defaultValue: 'ollama',
  },
  aiPersonalizationEnabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  aiApprovalRequired: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  totalLeads: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  emailsSent: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  emailsDelivered: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  emailsOpened: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  emailsClicked: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  emailsReplied: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  emailsBounced: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  emailsUnsubscribed: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
}, {
  sequelize,
  tableName: 'campaigns',
  timestamps: true,
  underscored: true,
});

module.exports = Campaign;