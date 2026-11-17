-- ============================================================================
-- Prompt 6 — Campaign & Outreach Engine: MySQL 8 migration
--
-- Adds the email-sending layer on top of the existing Prompt 5 schema:
--   * smtp_accounts            — self-hosted SMTP credentials (AES-256-GCM at rest)
--   * suppressions             — org-wide suppression list (unsubscribe/bounce/block)
--   * email_jobs               — durable send queue claimed atomically by workers
--   * email_events             — immutable event stream (QUEUED..UNSUBSCRIBED)
--   * campaigns                — new sending/schedule/AI columns
--   * campaign_leads           — per-recipient send state columns
--
-- Dev (SQLite) uses `sequelize.sync({ alter: true })`; production (MySQL 8)
-- must apply THIS migration. Never manually alter production schema.
-- Run with any MySQL migration runner, e.g.:
--   mysql -u admin -p salesfire < migrations/001-prompt6-campaign-engine.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SMTP sending accounts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `smtp_accounts` (
  `id`               CHAR(36)     NOT NULL PRIMARY KEY,
  `organization_id`  CHAR(36)     NOT NULL,
  `created_by`       CHAR(36)     NULL,
  `name`             VARCHAR(120) NOT NULL,
  `host`             VARCHAR(255) NOT NULL,
  `port`             INT          NOT NULL DEFAULT 587,
  `security`         ENUM('none','tls','ssl') NOT NULL DEFAULT 'tls',
  `username`         VARCHAR(255) NULL,
  -- AES-256-GCM ciphertext: iv.tag.ciphertext (base64). NEVER plaintext.
  -- NEVER returned by any API.
  `password_enc`     TEXT         NOT NULL,
  `from_email`       VARCHAR(255) NOT NULL,
  `from_name`        VARCHAR(255) NULL,
  `reply_to`         VARCHAR(255) NULL,
  `daily_limit`      INT          NOT NULL DEFAULT 400,
  `hourly_limit`     INT          NOT NULL DEFAULT 40,
  `min_delay_minutes` INT         NOT NULL DEFAULT 5,
  `max_delay_minutes` INT         NOT NULL DEFAULT 15,
  `enabled`          TINYINT(1)   NOT NULL DEFAULT 1,
  `last_tested_at`   TIMESTAMP    NULL,
  `last_test_ok`     TINYINT(1)   NULL,
  `last_test_message` VARCHAR(500) NULL,
  `created_at`       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`       TIMESTAMP    NULL,
  CONSTRAINT `fk_smtp_accounts_org` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`),
  INDEX `idx_smtp_accounts_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------------------
-- 2. Organization-wide suppression list
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `suppressions` (
  `id`              CHAR(36)     NOT NULL PRIMARY KEY,
  `organization_id` CHAR(36)     NOT NULL,
  -- 191 to allow a UNIQUE prefix index under utf8mb4 (767-byte limit safety).
  `email`           VARCHAR(191) NOT NULL,
  `reason`          ENUM('unsubscribed','bounced','blocked','invalid','complaint') NOT NULL,
  `campaign_id`     CHAR(36)     NULL,
  `created_at`      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_suppression_org_email` (`organization_id`, `email`),
  INDEX `idx_suppressions_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------------------
-- 3. Durable email job queue (claimed atomically; exactly-once per step)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `email_jobs` (
  `id`                    CHAR(36)    NOT NULL PRIMARY KEY,
  `organization_id`       CHAR(36)    NOT NULL,
  `campaign_id`           CHAR(36)    NOT NULL,
  `campaign_recipient_id` CHAR(36)    NOT NULL,
  `step_id`               CHAR(36)    NOT NULL,
  -- pending -> claimed -> sent | failed | cancelled | suppressed
  `status`                VARCHAR(20) NOT NULL DEFAULT 'pending',
  `attempts`              INT         NOT NULL DEFAULT 0,
  `max_attempts`          INT         NOT NULL DEFAULT 3,
  `failure_class`         VARCHAR(20) NULL,  -- permanent | transient | auth | dns
  `last_error`            VARCHAR(500) NULL,
  `scheduled_for`         TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `claimed_at`            TIMESTAMP   NULL,
  `claimed_by`            VARCHAR(80) NULL,  -- worker id holding the lease
  `message_id`            VARCHAR(255) NULL,
  `sent_at`               TIMESTAMP   NULL,
  `created_at`            TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- Exactly-once guard: a recipient/step pair can only ever be queued once
  -- per scheduling pass. Application code also uses a guarded UPDATE claim.
  UNIQUE KEY `uq_email_job_recipient_step` (`campaign_recipient_id`, `step_id`),
  INDEX `idx_email_jobs_due` (`status`, `scheduled_for`),
  INDEX `idx_email_jobs_campaign` (`campaign_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------------------
-- 4. Email event stream (append-only)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `email_events` (
  `id`                    CHAR(36)     NOT NULL PRIMARY KEY,
  `organization_id`       CHAR(36)     NOT NULL,
  `campaign_id`           CHAR(36)     NOT NULL,
  `campaign_recipient_id` CHAR(36)     NULL,
  `email_job_id`          CHAR(36)     NULL,
  `message_id`            VARCHAR(255) NULL,
  `event_type`            ENUM('QUEUED','SENDING','SENT','DELIVERED','BOUNCED','FAILED','REPLIED','UNSUBSCRIBED') NOT NULL,
  `event_timestamp`       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `provider_event_id`     VARCHAR(255) NULL,
  `metadata`              JSON         NULL,
  `created_at`            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_email_events_campaign` (`campaign_id`, `event_timestamp`),
  INDEX `idx_email_events_recipient` (`campaign_recipient_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------------------
-- 5. Campaigns: new sending / schedule / AI columns
-- ----------------------------------------------------------------------------
ALTER TABLE `campaigns`
  ADD COLUMN IF NOT EXISTS `sending_account_id`     CHAR(36)     NULL AFTER `status`,
  ADD COLUMN IF NOT EXISTS `hourly_limit`           INT          NULL AFTER `max_emails_per_day`,
  ADD COLUMN IF NOT EXISTS `min_delay_minutes`      INT          NOT NULL DEFAULT 5 AFTER `hourly_limit`,
  ADD COLUMN IF NOT EXISTS `max_delay_minutes`      INT          NOT NULL DEFAULT 15 AFTER `min_delay_minutes`,
  ADD COLUMN IF NOT EXISTS `total_failed`           INT          NOT NULL DEFAULT 0 AFTER `emails_unsubscribed`,
  ADD COLUMN IF NOT EXISTS `archived_at`            TIMESTAMP    NULL AFTER `cancelled_at`,
  ADD COLUMN IF NOT EXISTS `ai_personalization_depth` VARCHAR(20) NOT NULL DEFAULT 'standard' AFTER `ai_personalization_enabled`;

ALTER TABLE `campaigns`
  ADD CONSTRAINT `fk_campaigns_smtp_account` FOREIGN KEY (`sending_account_id`) REFERENCES `smtp_accounts` (`id`);

-- ----------------------------------------------------------------------------
-- 6. Campaign recipients (campaign_leads): per-recipient send state
-- ----------------------------------------------------------------------------
ALTER TABLE `campaign_leads`
  MODIFY COLUMN `lead_id` CHAR(36) NULL;  -- recipients may be enrolled without Lead rows

ALTER TABLE `campaign_leads`
  ADD COLUMN IF NOT EXISTS `current_step`    INT         NOT NULL DEFAULT 1 AFTER `status`,
  ADD COLUMN IF NOT EXISTS `next_send_at`    TIMESTAMP   NULL AFTER `current_step`,
  ADD COLUMN IF NOT EXISTS `last_sent_at`    TIMESTAMP   NULL AFTER `next_send_at`,
  ADD COLUMN IF NOT EXISTS `replied_at`      TIMESTAMP   NULL AFTER `last_sent_at`,
  ADD COLUMN IF NOT EXISTS `unsubscribed_at` TIMESTAMP   NULL AFTER `replied_at`,
  ADD COLUMN IF NOT EXISTS `bounced_at`      TIMESTAMP   NULL AFTER `unsubscribed_at`;

ALTER TABLE `campaign_leads`
  ADD INDEX IF NOT EXISTS `idx_campaign_leads_next_send` (`campaign_id`, `status`, `next_send_at`);
