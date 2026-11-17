// CampaignEmailTemplate Model - Prompt 5
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class CampaignEmailTemplate extends Model {
  static associate(models) {
    this.belongsTo(models.Campaign, { as: 'campaign', foreignKey: 'campaign_id' });
  }
}

CampaignEmailTemplate.init({
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
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  subject: {
    type: DataTypes.STRING(500),
    allowNull: false,
  },
  body: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  variables: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    field: 'is_active',
  },
}, {
  sequelize,
  tableName: 'campaign_email_templates',
  timestamps: true,
  underscored: true,
});

module.exports = CampaignEmailTemplate;
