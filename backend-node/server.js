// Main Application - Node.js Backend (Prompt 5 AI Outreach & Campaign Engine)
// Equivalent to backend/app/main.py - Node.js version

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Initialize Express
const app = express();
const port = process.env.PORT || 8000;

// ============================================================================
// Security Middleware (Prompt 1 - Security-First Architecture)
// ============================================================================

// 1. Trusted Host Middleware
app.set('trust proxy', 1);

// 2. Security Headers (Helmet)
app.use(helmet());
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    connectSrc: ["'self'"],
  }
}));

// 3. CORS Configuration (restrictive, production-ready)
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  maxAge: 86400
};
app.use(cors(corsOptions));

// 4. Rate Limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 300,
  message: 'Too many requests. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', globalLimiter);

// 5. Body Parsing
// Skip the global 10kb JSON limit for the leads-import endpoints — those set
// their own larger parser (parsed spreadsheet rows travel as JSON).
app.use((req, res, next) => {
  if (req.path.startsWith('/api/v1/leads/import')) return next();
  express.json({ limit: '10kb' })(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// 5b. Cookie parsing (HttpOnly auth tokens)
app.use(cookieParser());

// 6. Request ID middleware
app.use((req, res, next) => {
  req.requestId = uuidv4 ? uuidv4() : 'req-' + Date.now();
  next();
});

// 7. SSRF Protection middleware
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') && req.query && req.query.url) {
    const { isSafeUrl } = require('./security');
    if (!isSafeUrl(req.query.url)) {
      return res.status(403).json({ error: 'Unsafe URL detected' });
    }
  }
  next();
});

// 8. Structured request logging
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[${req.requestId}] ${req.method} ${req.path} - ${req.ip}`);
  }
  next();
});

// 9. Health check middleware (placed early)
app.use('/health', async (req, res, next) => {
  try {
    const { sequelize, getDbType, connectDB } = require('./db');
    let dbStatus = 'disconnected';
    
    try {
      if (sequelize) {
        await sequelize.authenticate();
        dbStatus = 'connected';
      }
    } catch (err) {
      dbStatus = 'error';
    }
    
    req.dbStatus = dbStatus;
    next();
  } catch (err) {
    req.dbStatus = 'error';
    next();
  }
});

// ============================================================================
// API Routes (mounted BEFORE the 404 handler)
// ============================================================================

// 9. Error handling middleware (registered after routes below)
// ============================================================================
// Database Connection (MySQL 8 or SQLite fallback)
// ============================================================================

// Load db after middleware to avoid blocking startup
const { sequelize, connectDB, getDbType } = require('./db');

connectDB().then(() => {

  // ============================================================================
  // Root Route
  // ============================================================================
  app.get('/', (req, res) => {
    res.json({
      message: 'B2B Lead Intelligence Platform API',
      version: '0.1.0',
      endpoints: {
        health: '/health',
        api: '/api/v1/*'
      },
      database: getDbType() || 'unknown'
    });
  });

  // ============================================================================
  // Health Check Route
  // ============================================================================
  app.get('/health', (req, res) => {
    const dbStatus = req.dbStatus || 'unknown';
    const isHealthy = dbStatus === 'connected';
    
    res.json({
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      environment: process.env.ENVIRONMENT,
      version: '0.1.0',
      database: getDbType() || 'unknown',
      databaseStatus: dbStatus,
      uptime: process.uptime()
    });
  });

  // ============================================================================
  // API v1 Routes - Auth + Campaigns + Email Sending + Unsubscribe
  // ============================================================================
  app.use('/api/v1/auth', require('./routes/auth'));
  app.use('/api/v1/campaigns', require('./routes/campaigns'));
  app.use('/api/v1/campaigns', require('./routes/campaign-accounts'));
  app.use('/api/v1/email-sending', require('./routes/email-sending'));
  app.use('/api/v1/signatures', require('./routes/signatures'));
  app.use('/api/v1/unsubscribe', require('./routes/unsubscribe'));
  app.use('/api/v1/leads', require('./routes/leads'));
  app.use('/api/v1/lists', require('./routes/lists'));
  app.use('/api/v1/conversations', require('./routes/conversations').conversationsRouter);
  app.use('/api/v1/email-sync', require('./routes/conversations').syncRouter);
  app.use('/api/v1/notifications', require('./routes/notifications'));
  app.use('/api/v1/members', require('./routes/members'));
  app.use('/api/v1/ai', require('./routes/ai'));
  app.use('/api/v1/deliverability', require('./routes/deliverability'));

  // ============================================================================
  // Campaign Engine Worker - processes due email jobs (Prompt 6 §33).
  // Every tick re-checks campaign status, suppression, limits and schedule.
  // ============================================================================
  const engine = require('./services/campaign-engine');
  engine.startWorker(20000);
  console.log(`📬 Campaign worker started (${engine.WORKER_ID})`);

  const inboxSync = require('./services/inbound-email-worker');
  inboxSync.startInboundSyncWorker();

  // ============================================================================
  // Warm-up Worker (Prompt 8) - graduated real sends from cold accounts.
  // Sends real warm-up mail to seed mailboxes; every number it reports is an
  // actual SMTP outcome — nothing is simulated. Set WARMUP_ENABLED=false to
  // disable the tick in environments where sends must not fire.
  // ============================================================================
  if (String(process.env.WARMUP_ENABLED || 'true').toLowerCase() !== 'false') {
    const warmup = require('./services/warmup');
    warmup.startWarmupWorker(60000);
    console.log('🔥 Warm-up worker started');
  }

  // ============================================================================
  // Error Handler (must be registered AFTER all routes)
  // ============================================================================
  app.use((err, req, res, next) => {
    console.error(`[${req.requestId}] Error:`, err);
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
      error: process.env.ENVIRONMENT === 'development' ? err.message : 'Internal Server Error',
      requestId: req.requestId,
      timestamp: new Date().toISOString()
    });
  });

  // ============================================================================
  // 404 Handler
  // ============================================================================
  app.use((req, res) => {
    res.status(404).json({
      error: 'Endpoint not found',
      requestId: req.requestId
    });
  });

  // ============================================================================
  // Start Server
  // ============================================================================
  const server = app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`📍 Environment: ${process.env.ENVIRONMENT}`);
    console.log(`📍 API Base: http://localhost:${port}/api/v1`);
    console.log(`📍 Health: http://localhost:${port}/health`);
    console.log(`📍 Database: ${getDbType() || 'unknown'}`);
    console.log(`📍 Frontend: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
  });
  // WebSocket realtime (live preview, campaign/sequence sync) — cookie auth.
  require('./services/realtime').init(server);

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received. Shutting down gracefully...');
    server.close(() => {
      console.log('🔌 Server closed');
      sequelize.close().then(() => {
        console.log('📊 Database connection closed');
        process.exit(0);
      });
    });
  });

}).catch(err => {
  console.error('❌ Failed to start server:', err);
  // Fallback: start without database
  startServerWithoutDb();
});

function startServerWithoutDb() {
  // Start without database connection
  try {
    const server = app.listen(port, () => {
      console.log(`🚀 Server running on port ${port} (without database)`);
      console.log(`📍 Health: http://localhost:${port}/health`);
      console.log(`⚠️  Database connection unavailable - running in limited mode`);
    });
    require('./services/realtime').init(server);
    
    process.on('SIGTERM', () => {
      server.close(() => {
        process.exit(0);
      });
    });
  } catch (e) {
    console.error('Failed to start server even without DB:', e);
    process.exit(1);
  }
}

// Helper: get DataTypes from Sequelize
const { DataTypes } = require('sequelize');

// Helper function to create models (lazy loading)
function createModel(name, attributes, options = {}) {
  return sequelize.define(name, attributes, {
    timestamps: options.timestamps !== false,
    paranoid: options.paranoid || false,
    underscored: true,
    ...options
  });
}