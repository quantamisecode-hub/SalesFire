// AuditLog — PROMPT 9.1 §68. Append-only record of privileged account and
// pool actions. NEVER store secrets (passwords, tokens, keys) in details.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class AuditLog extends Model {
  static associate(models) {
    this.belongsTo(models.Organization, { as: 'organization', foreignKey: 'organizationId' });
    this.belongsTo(models.User, { as: 'actor', foreignKey: 'actorId' });
  }
}

AuditLog.init({
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
  actorId: {
    type: DataTypes.UUID,
    field: 'actor_id',
  },
  // sending_account.created | sending_account.updated | sending_account.paused
  // | sending_account.resumed | sending_account.deleted | sending_account.smtp_tested
  // | pool.account_added | pool.account_removed | pool.distribution_changed | pool.weights_changed
  action: {
    type: DataTypes.STRING(80),
    allowNull: false,
  },
  entityType: {
    type: DataTypes.STRING(40),
    field: 'entity_type',
  },
  entityId: {
    type: DataTypes.STRING(64),
    field: 'entity_id',
  },
  details: {
    type: DataTypes.JSON,
  },
}, {
  sequelize,
  tableName: 'audit_logs',
  underscored: true,
  timestamps: true,
  updatedAt: false,
});

module.exports = AuditLog;
