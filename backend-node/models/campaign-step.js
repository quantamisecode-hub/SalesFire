// CampaignStep Model - Prompt 5
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class CampaignStep extends Model {
  static associate(models) {
    this.belongsTo(models.CampaignSequence, { as: 'sequence', foreignKey: 'sequenceId' });
    this.hasMany(models.CampaignStepVariant, { as: 'variants', foreignKey: 'stepId' });
  }
}

CampaignStep.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  sequenceId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'sequence_id',
  },
  organizationId: {
    type: DataTypes.UUID,
    field: 'organization_id',
  },
  stepOrder: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  name: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  subjectTemplate: {
    type: DataTypes.STRING(500),
    allowNull: false,
  },
  bodyTemplate: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  delayDays: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  delayHours: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  // Sequence Builder wait configuration (§7): minutes/hours/days supported.
  delayMinutes: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  sendDaysOfWeek: {
    type: DataTypes.JSON,
  },
  sendBetweenStartHour: {
    type: DataTypes.INTEGER,
  },
  sendBetweenEndHour: {
    type: DataTypes.INTEGER,
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  aiPersonalizeSubject: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  aiPersonalizeBody: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  aiApprovalRequired: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
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
}, {
  sequelize,
  tableName: 'campaign_steps',
  timestamps: true,
  underscored: true,
});

module.exports = CampaignStep;