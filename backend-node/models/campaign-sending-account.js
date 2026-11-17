// CampaignSendingAccount Model - Prompt 5
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class CampaignSendingAccount extends Model {
  static associate(models) {
    this.belongsTo(models.Campaign, { as: 'campaign', foreignKey: 'campaign_id' });
  }
}

CampaignSendingAccount.init({
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
  emailAddress: {
    type: DataTypes.STRING(255),
    allowNull: false,
    field: 'email_address',
  },
  displayName: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'display_name',
  },
  smtpHost: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'smtp_host',
  },
  smtpPort: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'smtp_port',
  },
  smtpUsername: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'smtp_username',
  },
  // Stored encrypted-at-rest in production; never returned to the client.
  smtpPassword: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'smtp_password',
  },
  status: {
    type: DataTypes.STRING(50),
    defaultValue: 'active',
  },
  lastTestedAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'last_tested_at',
  },
  lastTestResult: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'last_test_result',
  },
}, {
  sequelize,
  tableName: 'campaign_sending_accounts',
  timestamps: true,
  underscored: true,
});

module.exports = CampaignSendingAccount;
