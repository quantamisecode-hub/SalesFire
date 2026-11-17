// Organization-Membership Model - Equivalent to backend/app/models/organization_membership.py
const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');

const OrganizationMembership = sequelize.define('OrganizationMembership', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
    allowNull: false,
  },
  organizationId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'organization_id',
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    field: 'user_id',
  },
  role: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'member',
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  joinedAt: {
    type: DataTypes.DATE,
    field: 'joined_at',
    defaultValue: DataTypes.NOW,
  },
  leftAt: {
    type: DataTypes.DATE,
    field: 'left_at',
  },
}, {
  tableName: 'organization_memberships',
  timestamps: true,
  underscored: true,
});

module.exports = OrganizationMembership;