// ImportJob Model — real import progress for the leads import workflow (§28-30).
// The import worker updates counters in batches; the UI polls GET /import/:jobId.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class ImportJob extends Model {}

ImportJob.init({
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
  // pending | processing | completed | failed
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'pending',
  },
  filename: {
    // Sanitized display name only — never used to build filesystem paths (§39).
    type: DataTypes.STRING(255),
  },
  format: {
    type: DataTypes.STRING(10), // xlsx | csv
  },
  mapping: {
    type: DataTypes.JSON, // { columnIndex: fieldName | 'custom:<slug>' | 'skip' }
  },
  duplicateStrategy: {
    type: DataTypes.STRING(30),
    defaultValue: 'skip', // skip | update
    field: 'duplicate_strategy',
  },
  campaignId: {
    type: DataTypes.UUID,
    allowNull: true, // when importing straight into a campaign audience
    field: 'campaign_id',
  },
  // Parsed source rows (already validated size/row cap at upload time)
  rows: {
    type: DataTypes.JSON, // array of arrays (raw cell values per row)
  },
  // Real counters
  totalRows: { type: DataTypes.INTEGER, defaultValue: 0, field: 'total_rows' },
  processed: { type: DataTypes.INTEGER, defaultValue: 0 },
  imported: { type: DataTypes.INTEGER, defaultValue: 0 },
  skipped: { type: DataTypes.INTEGER, defaultValue: 0 },
  failed: { type: DataTypes.INTEGER, defaultValue: 0 },
  errorReport: {
    type: DataTypes.JSON, // [{ row, email, reason }]
    field: 'error_report',
  },
  errorMessage: {
    type: DataTypes.STRING(500),
    field: 'error_message',
  },
}, {
  sequelize,
  tableName: 'import_jobs',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['organization_id'] },
    { fields: ['organization_id', 'status'] },
  ],
});

module.exports = ImportJob;
