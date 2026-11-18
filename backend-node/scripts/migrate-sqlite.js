// Dev/SQLite migration — applies the column additions from
// migrations/004-multi-sending-accounts.sql to a SQLite database
// (dev database.sqlite). Idempotent: skips columns/tables that exist.
// Usage: node scripts/migrate-sqlite.js            (default ./database.sqlite)
//        DATABASE_URL=sqlite:./file.sqlite node scripts/migrate-sqlite.js
process.env.DATABASE_URL = process.env.DATABASE_URL || 'sqlite:./database.sqlite';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'migrate-sqlite-not-secret-key-32b!';

const { sequelize } = require('../db');
require('../models');

async function columns(table) {
  const [rows] = await sequelize.query(`PRAGMA table_info(${table})`);
  return rows.map((r) => r.name);
}

async function tableExists(table) {
  const [rows] = await sequelize.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
    { replacements: [table] }
  );
  return rows.length > 0;
}

async function addColumn(table, name, ddl) {
  const cols = await columns(table);
  if (cols.includes(name)) {
    console.log(`  skip  ${table}.${name} (exists)`);
    return;
  }
  await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  console.log(`  add   ${table}.${name}`);
}

(async () => {
  await sequelize.authenticate();
  console.log('Migrating', sequelize.options.storage);

  await addColumn('smtp_accounts', 'health_status', "health_status TEXT NOT NULL DEFAULT 'unknown'");
  await addColumn('smtp_accounts', 'warmup_status', "warmup_status TEXT NOT NULL DEFAULT 'not_started'");
  await addColumn('smtp_accounts', 'warmup_daily_limit', 'warmup_daily_limit INTEGER');
  await addColumn('smtp_accounts', 'timezone', "timezone TEXT NOT NULL DEFAULT 'UTC'");
  await addColumn('smtp_accounts', 'sending_schedule', 'sending_schedule TEXT');
  await addColumn('smtp_accounts', 'last_sent_at', 'last_sent_at DATETIME');
  await addColumn('smtp_accounts', 'minimum_wait_minutes', 'minimum_wait_minutes INTEGER NOT NULL DEFAULT 1');

  await addColumn('campaigns', 'account_distribution', "account_distribution TEXT NOT NULL DEFAULT 'round_robin'");
  await addColumn('campaigns', 'account_stickiness', "account_stickiness TEXT NOT NULL DEFAULT 'rotate'");
  await addColumn('campaigns', 'fallback_policy', "fallback_policy TEXT NOT NULL DEFAULT 'reassign'");

  await addColumn('campaign_leads', 'sending_account_id', 'sending_account_id UUID');
  await addColumn('campaign_leads', 'assignment_method', 'assignment_method TEXT');
  await addColumn('campaign_leads', 'assigned_at', 'assigned_at DATETIME');

  await addColumn('email_jobs', 'sending_account_id', 'sending_account_id UUID');
  await addColumn('email_jobs', 'idempotency_key', 'idempotency_key TEXT');

  await addColumn('email_events', 'sending_account_id', 'sending_account_id UUID');
  await addColumn('email_events', 'sequence_step_id', 'sequence_step_id UUID');
  await addColumn('email_events', 'variant_id', 'variant_id UUID');

  for (const tbl of ['campaign_account_pools', 'sending_account_usage', 'audit_logs']) {
    console.log(`  ${(await tableExists(tbl)) ? 'ok' : 'MISSING'}    ${tbl}`);
  }

  const indexes = [
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_email_jobs_idempotency ON email_jobs (idempotency_key)',
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_usage_account_period ON sending_account_usage (smtp_account_id, period_type, period_key)',
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_pool_campaign_account ON campaign_account_pools (campaign_id, smtp_account_id)',
  ];
  for (const sql of indexes) {
    try {
      await sequelize.query(sql);
      console.log('  ok    index');
    } catch (e) {
      console.log(`  warn  index failed: ${e.message}`);
    }
  }

  console.log('Migration complete.');
  await sequelize.close();
})().catch((e) => { console.error('Migration failed:', e); process.exit(1); });
