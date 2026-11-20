// WarmupPlan Model - per-SMTP-account deliverability warm-up ramp (Prompt 8).
// Every number here comes from real SMTP outcomes — nothing is simulated.
// The health score is derived from actual send results (see services/warmup.js).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class WarmupPlan extends Model {
  static associate(models) {
    this.belongsTo(models.SmtpAccount, { as: 'account', foreignKey: 'accountId', onDelete: 'CASCADE' });
    this.belongsTo(models.Organization, { as: 'organization', foreignKey: 'organizationId' });
  }
}

WarmupPlan.init({
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
  accountId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'account_id',
    unique: true, // one active plan per account
  },
  // active | paused | completed | disabled
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'active',
  },
  // Ramp: startVolume on day 1, grow by rampStep per day up to targetVolume.
  startVolume: {
    type: DataTypes.INTEGER,
    field: 'start_volume',
    defaultValue: 2,
  },
  rampStep: {
    type: DataTypes.INTEGER,
    field: 'ramp_step',
    defaultValue: 2,
  },
  targetVolume: {
    type: DataTypes.INTEGER,
    field: 'target_volume',
    defaultValue: 40,
  },
  startedOn: {
    type: DataTypes.DATEONLY,
    field: 'started_on',
    defaultValue: DataTypes.NOW,
  },
  disabledAt: {
    type: DataTypes.DATE,
    field: 'disabled_at',
  },
  sentToday: {
    type: DataTypes.INTEGER,
    field: 'sent_today',
    defaultValue: 0,
  },
  sentTodayDate: {
    type: DataTypes.DATEONLY,
    field: 'sent_today_date',
  },
  totalSent: {
    type: DataTypes.INTEGER,
    field: 'total_sent',
    defaultValue: 0,
  },
  totalFailed: {
    type: DataTypes.INTEGER,
    field: 'total_failed',
    defaultValue: 0,
  },
  // Seed recipients (addresses used as warm-up partners). Comma-separated.
  // The engine cycles through them; bounced/failed seeds are skipped next run.
  seedRecipients: {
    type: DataTypes.TEXT,
    field: 'seed_recipients',
  },
  consecutiveFailureDays: {
    type: DataTypes.INTEGER,
    field: 'consecutive_failure_days',
    defaultValue: 0,
  },
}, {
  sequelize,
  tableName: 'warmup_plans',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['organization_id', 'status'] },
    { fields: ['account_id'], unique: true },
  ],
});

module.exports = WarmupPlan;
