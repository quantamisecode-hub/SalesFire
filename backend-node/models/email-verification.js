// EmailVerification Model - recorded result of a real verification run.
// Statuses: valid | invalid | risky | unknown. Never fabricated.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class EmailVerification extends Model {
  static associate(models) {
    this.belongsTo(models.Lead, { as: 'lead', foreignKey: 'leadId' });
    this.belongsTo(models.Organization, { as: 'organization', foreignKey: 'organizationId' });
  }
}

EmailVerification.init({
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
  leadId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'lead_id',
  },
  email: {
    type: DataTypes.STRING(320),
    allowNull: false,
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'unknown',
  },
  riskScore: {
    type: DataTypes.INTEGER,
    field: 'risk_score',
    allowNull: false,
    defaultValue: 100,
  },
  reasons: {
    type: DataTypes.JSON,
    allowNull: false,
  },
  durationMs: {
    type: DataTypes.INTEGER,
    field: 'duration_ms',
    defaultValue: 0,
  },
  // Snapshot of the DNS answer set used (auditability).
  mxRecords: {
    type: DataTypes.JSON,
    field: 'mx_records',
  },
}, {
  sequelize,
  tableName: 'email_verifications',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['organization_id', 'email'] },
    { fields: ['lead_id'] },
    { fields: ['organization_id', 'status'] },
  ],
});

module.exports = EmailVerification;
