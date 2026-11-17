// Suppression Model - global, per-organization suppression list (Prompt 6 §35).
// A suppressed email must never receive a campaign send.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class Suppression extends Model {
  static associate(models) {
    this.belongsTo(models.Organization, { as: 'organization', foreignKey: 'organizationId' });
  }
}

Suppression.init({
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
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    set(value) {
      this.setDataValue('email', String(value || '').trim().toLowerCase());
    },
  },
  // unsubscribed | hard_bounce | soft_bounce | invalid | blocked | complained
  reason: {
    type: DataTypes.STRING(50),
    allowNull: false,
  },
  // campaign | unsubscribe_link | manual | bounce_processing | import
  source: {
    type: DataTypes.STRING(50),
    defaultValue: 'manual',
  },
  campaignId: {
    type: DataTypes.UUID,
    field: 'campaign_id',
  },
  note: {
    type: DataTypes.STRING(500),
  },
}, {
  sequelize,
  tableName: 'suppressions',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['organization_id', 'email'] },
  ],
});

module.exports = Suppression;
