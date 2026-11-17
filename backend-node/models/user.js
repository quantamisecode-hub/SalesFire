// User Model - Equivalent to backend/app/models/user.py
const { DataTypes } = require('sequelize');
const { sequelize } = require('../db');
const {
  hashPassword,
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
} = require('../security');
const { v4: uuidv4 } = require('uuid');

const User = sequelize.define('User', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
    allowNull: false,
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true,
    },
  },
  fullName: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  passwordHash: {
    type: DataTypes.TEXT,
    allowNull: false,
    field: 'password_hash',
  },
  organizationId: {
    type: DataTypes.UUID,
    allowNull: true,
    field: 'organization_id',
  },
  role: {
    type: DataTypes.STRING(50),
    defaultValue: 'member',
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  lastLoginAt: {
    type: DataTypes.DATE,
    field: 'last_login_at',
  },
  createdAt: {
    type: DataTypes.DATE,
    field: 'created_at',
    defaultValue: DataTypes.NOW,
  },
  updatedAt: {
    type: DataTypes.DATE,
    field: 'updated_at',
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'users',
  timestamps: true,
  underscored: true,
});

/**
 * Hook to hash password before saving
 */
User.beforeCreate(async (user) => {
  if (user.passwordHash) {
    user.passwordHash = await hashPassword(user.passwordHash);
  }
});

/**
 * Method to verify password
 */
User.prototype.comparePassword = async function (candidatePassword) {
  return verifyPassword(candidatePassword, this.passwordHash);
};

/**
 * Method to generate JWT tokens
 */
User.prototype.generateAuthTokens = function () {
  const accessToken = generateAccessToken(this.id, this.organizationId, [this.role]);
  const refreshToken = generateRefreshToken(this.id, this.organizationId, uuidv4());
  return { accessToken, refreshToken };
};

module.exports = User;