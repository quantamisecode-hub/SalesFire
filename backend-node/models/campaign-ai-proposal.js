// CampaignAIProposal Model - Prompt 5
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class CampaignAIProposal extends Model {
  static associate(models) {
    this.belongsTo(models.Campaign, { as: 'campaign', foreignKey: 'campaign_id' });
  }
}

CampaignAIProposal.init({
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
  stepId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'step_id',
  },
  proposedSubject: {
    type: DataTypes.STRING(500),
    allowNull: true,
    field: 'proposed_subject',
  },
  proposedBody: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'proposed_body',
  },
  aiProvider: {
    type: DataTypes.STRING(50),
    allowNull: true,
    field: 'ai_provider',
  },
  aiModel: {
    type: DataTypes.STRING(100),
    allowNull: true,
    field: 'ai_model',
  },
  status: {
    type: DataTypes.STRING(50),
    defaultValue: 'pending',
  },
  approvedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'approved_at',
  },
  rejectionReason: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'rejection_reason',
  },
}, {
  sequelize,
  tableName: 'campaign_ai_proposals',
  timestamps: true,
  underscored: true,
});

module.exports = CampaignAIProposal;
