// Node.js Backend Configuration - Equivalent to backend/app/core/config.py
require('dotenv').config();

const config = {
  port: process.env.PORT || 8000,
  environment: process.env.ENVIRONMENT || 'development',
  secretKey: process.env.JWT_SECRET || 'change-me-to-at-least-32-chars',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'change-refresh-secret',
  encryptionKey: process.env.ENCRYPTION_KEY || 'change-encryption-key',
  databaseUrl: process.env.DATABASE_URL || 'mysql8://root:@localhost/salesfire',
  apiV1Prefix: '/api/v1',
  
  // Security settings
  argon2idTimeCost: 2,     // Argon2id parameter
  argon2idMemoryCost: 64*1024,
  argon2idParallelism: 2,
  
  // Rate limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100 // limit each IP to 100 requests per windowMs
  }
};

module.exports = config;