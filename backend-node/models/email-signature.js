// EmailSignature Model — Prompt 9 §1, §2. Reusable, org-scoped signature
// entities. Association chain: each sending account may default to a signature,
// a campaign may override the account default, and a step may override both.
// "No signature" is an explicit NONE choice (never inferred from null) — see
// signature_mode on the referencing tables.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class EmailSignature extends Model {
  static associate(models) {
    this.belongsTo(models.Organization, { as: 'organization', foreignKey: 'organizationId' });
  }
}

EmailSignature.init({
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
    type: DataTypes.STRING(120),
    allowNull: false,
  },
  // HTML source, sanitized at render time by the template renderer
  // (defense in depth — never trusted client-side).
  html: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  // Plain-text fallback (used for text/plain MIME parts).
  text: {
    type: DataTypes.TEXT,
    allowNull: false,
    defaultValue: '',
  },
  // Org-wide default; exactly one true per org (enforced in the route layer).
  isOrgDefault: {
    type: DataTypes.BOOLEAN,
    field: 'is_org_default',
    defaultValue: false,
  },
}, {
  sequelize,
  tableName: 'email_signatures',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['organization_id', 'name'] },
    { fields: ['organization_id', 'is_org_default'] },
  ],
});

module.exports = EmailSignature;
