// SendingAccountUsage Model - PROMPT 9.1: atomic, database-backed sending
// quota reservation (day/hour periods). Reservation happens inside a
// transaction with a conditional UPDATE ... WHERE used < limit, so concurrent
// workers can never push an account past its limit — no application-level
// counters. One row per (account, period_type, period_key).
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class SendingAccountUsage extends Model {
  static associate(models) {
    this.belongsTo(models.SmtpAccount, { as: 'account', foreignKey: 'smtpAccountId' });
  }
}

SendingAccountUsage.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  smtpAccountId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'smtp_account_id',
  },
  periodType: {
    type: DataTypes.STRING(10),
    allowNull: false,
    field: 'period_type', // 'day' | 'hour'
    validate: { isIn: [['day', 'hour']] },
  },
  // UTC keys: day "YYYY-MM-DD", hour "YYYY-MM-DDTHHH".
  periodKey: {
    type: DataTypes.STRING(20),
    allowNull: false,
    field: 'period_key',
  },
  used: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
}, {
  sequelize,
  tableName: 'sending_account_usage',
  underscored: true,
  indexes: [
    { unique: true, fields: ['smtp_account_id', 'period_type', 'period_key'] },
  ],
});

module.exports = SendingAccountUsage;
