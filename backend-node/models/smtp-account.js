// SmtpAccount Model - organization-level SMTP sending accounts (Prompt 6).
// Passwords are stored encrypted (AES-256-GCM) and NEVER returned via APIs.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class SmtpAccount extends Model {
  static associate(models) {
    this.belongsTo(models.Organization, { as: 'organization', foreignKey: 'organizationId' });
    this.belongsTo(models.User, { as: 'creator', foreignKey: 'createdBy' });
    this.hasMany(models.Campaign, { as: 'campaigns', foreignKey: 'sendingAccountId' });
  }
}

SmtpAccount.init({
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
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  smtpHost: {
    type: DataTypes.STRING(255),
    allowNull: false,
    field: 'smtp_host',
  },
  smtpPort: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 587,
    field: 'smtp_port',
  },
  // none | tls (STARTTLS) | ssl (implicit TLS)
  security: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'tls',
  },
  smtpUsername: {
    type: DataTypes.STRING(255),
    field: 'smtp_username',
  },
  smtpPasswordEncrypted: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'smtp_password_encrypted',
  },
  fromEmail: {
    type: DataTypes.STRING(255),
    allowNull: false,
    field: 'from_email',
  },
  fromName: {
    type: DataTypes.STRING(255),
    field: 'from_name',
  },
  replyToEmail: {
    type: DataTypes.STRING(255),
    field: 'reply_to_email',
  },
  dailyLimit: {
    type: DataTypes.INTEGER,
    field: 'daily_limit',
  },
  // Signature resolution (Prompt 9): INHERIT | CUSTOM | NONE.
  signatureMode: {
    type: DataTypes.STRING(10),
    field: 'signature_mode',
    defaultValue: 'inherit',
  },
  signatureId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'signature_id',
  },
  hourlyLimit: {
    type: DataTypes.INTEGER,
    field: 'hourly_limit',
  },
  minDelayMinutes: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    field: 'min_delay_minutes',
  },
  // Instantly-style "Minimum wait time" — gap (in minutes) required between
  // two sends from THIS account, across ALL campaigns it's pooled into.
  minimumWaitMinutes: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
    field: 'minimum_wait_minutes',
  },
  maxDelayMinutes: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    field: 'max_delay_minutes',
  },
  isEnabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    field: 'is_enabled',
  },
  // PROMPT 9.1 — account health & warmup (real data only, derived where possible)
  healthStatus: {
    type: DataTypes.STRING(20),
    field: 'health_status',
    defaultValue: 'unknown', // healthy | warning | critical | unknown
  },
  warmupStatus: {
    type: DataTypes.STRING(20),
    field: 'warmup_status',
    defaultValue: 'not_started', // not_started | warming | active | paused | completed
  },
  warmupDailyLimit: {
    type: DataTypes.INTEGER,
    field: 'warmup_daily_limit',
  },
  // IANA timezone identifier (e.g. "America/New_York") — never a fixed UTC offset.
  timezone: {
    type: DataTypes.STRING(64),
    field: 'timezone',
    defaultValue: 'UTC',
  },
  // Per-day sending windows keyed by ISO day ("1".."7", 1=Monday):
  // { "1": { enabled: true, start: "09:00", end: "17:00" }, ... }
  // NULL = inherit campaign/default window (all weekdays 09-17).
  sendingSchedule: {
    type: DataTypes.JSON,
    field: 'sending_schedule',
  },
  lastSentAt: {
    type: DataTypes.DATE,
    field: 'last_sent_at',
  },
  status: {
    type: DataTypes.STRING(50),
    defaultValue: 'unverified',
  },
  lastTestedAt: {
    type: DataTypes.DATE,
    field: 'last_tested_at',
  },
  lastTestResult: {
    type: DataTypes.STRING(255),
    field: 'last_test_result',
  },
  createdBy: {
    type: DataTypes.UUID,
    field: 'created_by',
  },
  // IMAP (inbound) — optional; an account is "sync-configured" only when host+user+password are set.
  imapHost: { type: DataTypes.STRING(255), field: 'imap_host' },
  imapPort: { type: DataTypes.INTEGER, field: 'imap_port', defaultValue: 993 },
  imapSecure: { type: DataTypes.BOOLEAN, field: 'imap_secure', defaultValue: true },
  imapUsername: { type: DataTypes.STRING(255), field: 'imap_username' },
  imapPasswordEncrypted: { type: DataTypes.TEXT, field: 'imap_password_encrypted' },
  imapEnabled: { type: DataTypes.BOOLEAN, field: 'imap_enabled', defaultValue: false },
}, {
  sequelize,
  tableName: 'smtp_accounts',
  timestamps: true,
  underscored: true,
});

module.exports = SmtpAccount;
