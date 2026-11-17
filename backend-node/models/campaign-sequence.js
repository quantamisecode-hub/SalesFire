// CampaignSequence Model - Prompt 5
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class CampaignSequence extends Model {
  static associate(models) {
    this.belongsTo(models.Campaign, { as: 'campaign', foreignKey: 'campaignId' });
    this.hasMany(models.CampaignStep, { as: 'steps', foreignKey: 'sequenceId', onDelete: 'CASCADE' });
  }
}

CampaignSequence.init({
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
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  stepOrder: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
}, {
  sequelize,
  tableName: 'campaign_sequences',
  timestamps: true,
  underscored: true,
});

module.exports = CampaignSequence;