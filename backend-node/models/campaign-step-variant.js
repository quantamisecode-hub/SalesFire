// CampaignStepVariant Model — Sequence Builder (§9, §10, §42).
// A step holds one or more variants for A/B testing. `weight` is the variant's
// share of recipients (distribution); the sending engine picks a variant per
// recipient with a deterministic seeded choice, honoring the weights.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class CampaignStepVariant extends Model {
  static associate(models) {
    this.belongsTo(models.CampaignStep, { as: 'step', foreignKey: 'stepId', onDelete: 'CASCADE' });
  }
}

CampaignStepVariant.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  stepId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'step_id',
  },
  organizationId: {
    type: DataTypes.UUID,
    field: 'organization_id',
  },
  variantName: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'Variant A',
    field: 'variant_name',
  },
  variantOrder: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    field: 'variant_order',
  },
  subject: {
    type: DataTypes.STRING(500),
    allowNull: false,
    defaultValue: '',
  },
  bodyHtml: {
    type: DataTypes.TEXT,
    allowNull: false,
    defaultValue: '',
    field: 'body_html',
  },
  bodyText: {
    type: DataTypes.TEXT,
    allowNull: false,
    defaultValue: '',
    field: 'body_text',
  },
  // Relative A/B distribution. Normalized at render: weight / sum(weights).
  // Validated to total 100% at the API boundary (§10).
  weight: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 50,
    validate: { min: 0, max: 100 },
  },
}, {
  sequelize,
  tableName: 'campaign_step_variants',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['step_id'] },
    { fields: ['organization_id', 'step_id'] },
  ],
});

module.exports = CampaignStepVariant;
