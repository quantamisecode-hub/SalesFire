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

  await addColumn('smtp_accounts', 'imap_host', 'imap_host TEXT');
  await addColumn('smtp_accounts', 'imap_port', 'imap_port INTEGER');
  await addColumn('smtp_accounts', 'imap_secure', 'imap_secure INTEGER NOT NULL DEFAULT 1');
  await addColumn('smtp_accounts', 'imap_username', 'imap_username TEXT');
  await addColumn('smtp_accounts', 'imap_password_encrypted', 'imap_password_encrypted TEXT');
  await addColumn('smtp_accounts', 'imap_enabled', 'imap_enabled INTEGER NOT NULL DEFAULT 0');

  // Unified Inbox — tables created via sequelize.sync() in dev/test; production
  // applies migration 007. Guarded here with IF NOT EXISTS for parity.
  await sequelize.query(`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '(no subject)',
    status TEXT NOT NULL DEFAULT 'open',
    lead_id TEXT,
    campaign_id TEXT,
    sequence_id TEXT,
    sequence_step_id TEXT,
    sending_account_id TEXT,
    assigned_user_id TEXT,
    last_message_at TEXT,
    last_inbound_at TEXT,
    last_outbound_at TEXT,
    is_starred INTEGER NOT NULL DEFAULT 0,
    is_archived INTEGER NOT NULL DEFAULT 0,
    snoozed_until TEXT,
    tags TEXT,
    thread_status TEXT NOT NULL DEFAULT 'matched',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await sequelize.query(`CREATE TABLE IF NOT EXISTS email_messages (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    in_reply_to TEXT,
    "references" TEXT,
    direction TEXT NOT NULL,
    from_email TEXT,
    from_name TEXT,
    to_emails TEXT,
    cc_emails TEXT,
    bcc_emails TEXT,
    subject TEXT,
    text_body TEXT,
    html_body TEXT,
    snippet TEXT,
    headers TEXT,
    sent_at TEXT,
    received_at TEXT,
    status TEXT NOT NULL DEFAULT 'received',
    is_read INTEGER NOT NULL DEFAULT 0,
    message_type TEXT NOT NULL DEFAULT 'UNKNOWN',
    provider_message_id TEXT,
    mailbox_uid INTEGER,
    provider_name TEXT DEFAULT 'imap',
    sending_account_id TEXT,
    lead_id TEXT,
    campaign_id TEXT,
    sequence_id TEXT,
    sequence_step_id TEXT,
    idempotency_key TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await sequelize.query(`CREATE TABLE IF NOT EXISTS mailbox_sync_states (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    sending_account_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'imap',
    last_uid INTEGER,
    uid_validity INTEGER,
    last_sync_at TEXT,
    last_successful_sync_at TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    error_code TEXT,
    error_message TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await sequelize.query(`CREATE TABLE IF NOT EXISTS conversation_drafts (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    to_emails TEXT,
    cc_emails TEXT,
    bcc_emails TEXT,
    subject TEXT,
    text_body TEXT,
    html_body TEXT,
    sending_account_id TEXT,
    signature_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await sequelize.query(`CREATE TABLE IF NOT EXISTS conversation_insights (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5,
    source_message_id TEXT,
    model TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await sequelize.query(`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    conversation_id TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const inboxIndexes = [
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_email_messages_org_message_id ON email_messages (organization_id, message_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_email_messages_idempotency ON email_messages (idempotency_key)',
    'CREATE INDEX IF NOT EXISTS idx_email_messages_conversation_created ON email_messages (conversation_id, created_at)',
    'CREATE INDEX IF NOT EXISTS idx_email_messages_conversation_read ON email_messages (conversation_id, is_read)',
    'CREATE INDEX IF NOT EXISTS idx_email_messages_org_campaign ON email_messages (organization_id, campaign_id)',
    'CREATE INDEX IF NOT EXISTS idx_conversations_org_status ON conversations (organization_id, status)',
    'CREATE INDEX IF NOT EXISTS idx_conversations_org_assignee ON conversations (organization_id, assigned_user_id)',
    'CREATE INDEX IF NOT EXISTS idx_conversations_org_last_msg ON conversations (organization_id, last_message_at)',
    'CREATE INDEX IF NOT EXISTS idx_conversations_org_lead ON conversations (organization_id, lead_id)',
    'CREATE INDEX IF NOT EXISTS idx_conversations_org_account ON conversations (organization_id, sending_account_id)',
    'CREATE INDEX IF NOT EXISTS idx_conversations_org_archive ON conversations (organization_id, is_archived, last_message_at)',
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_mailbox_sync_org_account ON mailbox_sync_states (organization_id, sending_account_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_draft_conversation_user ON conversation_drafts (conversation_id, user_id)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_org_user_read ON notifications (organization_id, user_id, is_read)',
  ];
  for (const sql of inboxIndexes) {
    try { await sequelize.query(sql); console.log('  ok    index'); }
    catch (e) { console.log(`  warn  index failed: ${e.message}`); }
  }

  await addColumn('leads', 'assigned_to', 'assigned_to TEXT');

  // CRM holding lists (Instantly parity) — created via sync-style DDL so the
  // dev database matches production migration 006.
  await sequelize.query(`CREATE TABLE IF NOT EXISTS lead_lists (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await sequelize.query(`CREATE TABLE IF NOT EXISTS lead_list_members (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL REFERENCES lead_lists(id) ON DELETE CASCADE,
    lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL,
    added_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_lists_org_name ON lead_lists (organization_id, name)');
  await sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_list_members_pair ON lead_list_members (list_id, lead_id)');
  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_lead_list_members_lead ON lead_list_members (lead_id)');
  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_leads_assigned ON leads (organization_id, assigned_to)');
  console.log('  ok    lead_lists / lead_list_members / leads.assigned_to');

  for (const tbl of ['campaign_account_pools', 'sending_account_usage', 'audit_logs', 'lead_lists', 'lead_list_members']) {
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
