// Lead Model — Prompt: table-first Leads management + import workflow.
// One row per prospect in the organization. Custom personalization variables
// live in customFields (JSON) and become {{slug}} template variables.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

// Progression statuses flow from the sending engine; interest statuses are
// manual CRM-style signals (Instantly parity). We deliberately do NOT add
// open/click engagement statuses — open/click events are not tracked.
const LEAD_STATUSES = [
  'new', 'approved', 'contacted', 'replied', 'bounced', 'unsubscribed', 'suppressed', 'invalid',
  'completed',
  'interested', 'meeting_completed', 'meeting_completed_not_closed',
  'won', 'lost', 'not_interested', 'out_of_office', 'wrong_person',
];
// Statuses reset to 'new' when leads are moved between campaigns (Instantly's
// "reset interest status"). Progression statuses (contacted/replied/…) are kept.
const INTEREST_STATUSES = [
  'interested', 'meeting_completed', 'meeting_completed_not_closed',
  'won', 'lost', 'not_interested', 'out_of_office', 'wrong_person',
];
const EMAIL_STATUSES = ['unknown', 'discovered', 'syntax_valid', 'domain_valid', 'mx_valid', 'verified', 'invalid', 'bounced', 'unsubscribed'];

class Lead extends Model {
  static associate(models) {
    this.hasMany(models.CampaignLead, { as: 'campaignLeads', foreignKey: 'leadId' });
  }
}

Lead.init({
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
  createdBy: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'created_by',
  },
  firstName: { type: DataTypes.STRING(100), field: 'first_name' },
  lastName: { type: DataTypes.STRING(100), field: 'last_name' },
  companyName: { type: DataTypes.STRING(255), field: 'company_name' },
  jobTitle: { type: DataTypes.STRING(255), field: 'job_title' },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    validate: { isEmail: true },
  },
  phone: { type: DataTypes.STRING(50) },
  website: { type: DataTypes.STRING(255) },
  linkedin: { type: DataTypes.STRING(255) },
  location: { type: DataTypes.STRING(255) },
  industry: { type: DataTypes.STRING(255) },
  companySize: { type: DataTypes.STRING(50), field: 'company_size' },
  personalization: { type: DataTypes.TEXT },
  // Flexible custom variables: { recent_funding: "Series B", ... } (§21)
  customFields: {
    type: DataTypes.JSON,
    field: 'custom_fields',
  },
  status: {
    type: DataTypes.ENUM(...LEAD_STATUSES),
    defaultValue: 'new',
  },
  emailStatus: {
    type: DataTypes.ENUM(...EMAIL_STATUSES),
    defaultValue: 'unknown',
    field: 'email_status',
  },
  // Real ICP score when scoring has been performed; null = not scored (§8)
  leadScore: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'lead_score',
    validate: { min: 0, max: 100 },
  },
  // Owner assignment (Instantly lead-owner parity). FK to users.id, nullable.
  assignedTo: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'assigned_to',
  },
  source: {
    type: DataTypes.STRING(50),
    defaultValue: 'manual', // manual | import | lead_finder
  },
}, {
  sequelize,
  tableName: 'leads',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['organization_id'] },
    { fields: ['organization_id', 'email'], unique: true, name: 'uq_leads_org_email' },
    { fields: ['organization_id', 'company_name'] },
    { fields: ['organization_id', 'status'] },
    { fields: ['organization_id', 'email_status'] },
    { fields: ['organization_id', 'lead_score'] },
    { fields: ['organization_id', 'assigned_to'] },
    { fields: ['organization_id', 'created_at'] },
  ],
});

module.exports = Lead;
module.exports.LEAD_STATUSES = LEAD_STATUSES;
module.exports.INTEREST_STATUSES = INTEREST_STATUSES;
module.exports.EMAIL_STATUSES = EMAIL_STATUSES;
