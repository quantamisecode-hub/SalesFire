// Database Connection - Equivalent to backend/app/core/database.py
// Supports MySQL 8 for production, SQLite 3 for development/testing
const { Sequelize } = require('sequelize');
const config = require('./config');

// Try MySQL 8 first, fall back to SQLite 3 for development
// Defaults to SQLite3 for development (like original Python backend)
let sequelize;
let dbType = 'sqlite3';

if (config.databaseUrl && config.databaseUrl.includes('mysql')) {
  // MySQL 8 connection
  sequelize = new Sequelize(
    config.databaseUrl.replace('mysql8://', 'mysql://'),
    {
      dialect: 'mysql',
      dialectOptions: {
        timezone: '+00:00',
        dateStrings: true,
      },
      pool: {
        max: 10,
        min: 0,
        acquire: 30000,
        idle: 10000,
      },
      logging: config.environment !== 'production' ? console.log : false,
      benchmark: true,
    }
  );
  dbType = 'mysql8';
} else {
  // SQLite 3 development fallback (like original Python backend).
  // DATABASE_URL may point at a specific sqlite file (sqlite:./path); it is
  // honored so tests can use isolated databases. Default: ./database.sqlite.
  const path = require('path');
  let sqlitePath = path.resolve(process.cwd(), 'database.sqlite');
  if (config.databaseUrl && config.databaseUrl.startsWith('sqlite:')) {
    const raw = config.databaseUrl.replace(/^sqlite:/, '');
    sqlitePath = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  }

  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: sqlitePath,
    // SQLite serializes writes at the file level; multiple pooled connections
    // just produce SQLITE_BUSY under concurrent reservations (Prompt 9.1).
    pool: { max: 1, min: 0, acquire: 30000, idle: 10000 },
    logging: config.environment !== 'production' ? console.log : false,
  });
  dbType = 'sqlite3';
}

async function connectDB() {
  try {
    await sequelize.authenticate();
    console.log(`✅ Database connected successfully via ${dbType}`);

    // Register all models BEFORE syncing so the tables are created
    require('./models');

    // Sync models (in production, use migrations).
    // `alter: true` rebuilds tables on SQLite and is fragile with FK data, so
    // on failure we fall back to a plain sync (creates only missing tables —
    // non-destructive). Column additions to existing tables use the ALTER
    // scripts in backend-node/migrations/.
    if (config.environment === 'development') {
      try {
        await sequelize.sync({ alter: true });
        console.log('✅ Models synced with database (alter)');
      } catch (alterError) {
        console.warn('⚠️  alter sync failed, falling back to non-destructive sync:', alterError.message);
        await sequelize.sync();
        console.log('✅ Models synced with database (plain sync)');
      }
    }
    
    return sequelize;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    // Don't exit - allow app to start with limited functionality
    return null;
  }
}

// Get database type
function getDbType() {
  return dbType;
}

module.exports = { sequelize, connectDB, getDbType };