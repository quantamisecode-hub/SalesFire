// CampaignSendingAccount Model - PROMPT 9.1: campaign sending-account POOL.
// This REPLACES the legacy Prompt 5 stub (which stored plaintext SMTP passwords
// per campaign and was never used by the send path). One row = one account's
// membership in one campaign's pool, with its distribution weight.
//
//   Campaign 1---n CampaignSendingAccount n---1 SmtpAccount
//
// The campaign-level strategy (round_robin | weighted | availability_based) and
// stickiness/fallback live on the Campaign row. Weights only matter for the
// 'weighted' strategy and must sum to 100 across the enabled pool.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class CampaignSendingAccount extends Model {
  static associate(models) {
    this.belongsTo(models.Campaign, { as: 'campaign', foreignKey: 'campaignId' });
    this.belongsTo(models.SmtpAccount, { as: 'account', foreignKey: 'smtpAccountId' });
    this.belongsTo(models.Organization, { as: 'organization', foreignKey: 'organizationId' });
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
    allowNull: false,
    field: 'organization_id',
  },
  smtpAccountId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'smtp_account_id',
  },
  // Distribution weight (percent). Only meaningful for strategy=weighted.
  weight: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 100,
    validate: { min: 0, max: 100 },
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
}, {
  sequelize,
  tableName: 'campaign_account_pools',
  underscored: true,
  indexes: [
    { unique: true, fields: ['campaign_id', 'smtp_account_id'] },
    { fields: ['smtp_account_id'] },
    { fields: ['organization_id'] },
  ],
});

module.exports = CampaignSendingAccount;
