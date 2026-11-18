// LeadList / LeadListMember — CRM holding lists (Instantly parity).
// Leads in lists do NOT count toward any campaign's audience; moving a list
// into a campaign enrolls its members. Org-scoped; RBAC enforced in routes.
const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../db');

class LeadList extends Model {
  static associate(models) {
    this.hasMany(models.LeadListMember, { as: 'members', foreignKey: 'listId' });
  }
}

LeadList.init({
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
  name: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  createdBy: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'created_by',
  },
}, {
  sequelize,
  tableName: 'lead_lists',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['organization_id'] },
    { fields: ['organization_id', 'name'], unique: true, name: 'uq_lead_lists_org_name' },
  ],
});

class LeadListMember extends Model {
  static associate(models) {
    this.belongsTo(models.LeadList, { as: 'list', foreignKey: 'listId' });
    this.belongsTo(models.Lead, { as: 'lead', foreignKey: 'leadId' });
  }
}

LeadListMember.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  listId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'list_id',
  },
  leadId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'lead_id',
  },
  organizationId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'organization_id',
  },
  addedBy: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'added_by',
  },
}, {
  sequelize,
  tableName: 'lead_list_members',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['organization_id'] },
    { fields: ['list_id'] },
    { fields: ['lead_id'] },
    { fields: ['list_id', 'lead_id'], unique: true, name: 'uq_lead_list_members_pair' },
  ],
});

module.exports = { LeadList, LeadListMember };
