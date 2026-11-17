// CampaignLead Model - Prompt 5
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class CampaignLead extends Model {
  static associate(models) {
    this.belongsTo(models.Campaign, { as: 'campaign', foreignKey: 'campaignId' });
  }
}

CampaignLead.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  campaignId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'campaign_id',
  },
  organizationId: {
    type: DataTypes.UUID,
    field: 'organization_id',
  },
  leadId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'lead_id',
  },
  status: {
    type: DataTypes.STRING(50),
    defaultValue: 'pending',
  },
  // Recipient snapshot fields (denormalized at enroll time)
  email: {
    type: DataTypes.STRING(255),
    field: 'email',
  },
  firstName: {
    type: DataTypes.STRING(100),
    field: 'first_name',
  },
  lastName: {
    type: DataTypes.STRING(100),
    field: 'last_name',
  },
  companyName: {
    type: DataTypes.STRING(255),
    field: 'company_name',
  },
  jobTitle: {
    type: DataTypes.STRING(255),
    field: 'job_title',
  },
  // Send tracking
  currentStep: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    field: 'current_step',
  },
  nextSendAt: {
    type: DataTypes.DATE,
    field: 'next_send_at',
  },
  lastSentAt: {
    type: DataTypes.DATE,
    field: 'last_sent_at',
  },
  repliedAt: {
    type: DataTypes.DATE,
    field: 'replied_at',
  },
  unsubscribedAt: {
    type: DataTypes.DATE,
    field: 'unsubscribed_at',
  },
  bouncedAt: {
    type: DataTypes.DATE,
    field: 'bounced_at',
  },
  currentStepId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'current_step_id',
  },
  addedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'added_at',
  },
}, {
  sequelize,
  tableName: 'campaign_leads',
  timestamps: true,
  underscored: true,
});

module.exports = CampaignLead;
