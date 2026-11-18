-- ============================================================================
-- PROMPT 9.1 — Multi Sending Accounts, Account Pools, Rotation, Quota
--
-- MySQL 8 migration. Dev (SQLite) uses `sequelize.sync()`; production
-- (MySQL 8) MUST apply this migration before deploying Prompt 9.1 code.
-- Run: mysql -u admin -p salesfire < migrations/004-multi-sending-accounts.sql
--
-- NOTES
--   * The legacy `campaign_sending_accounts` table (plaintext SMTP creds,
--     Prompt 5 stub) is dropped. Credentials must live ONLY in `smtp_accounts`.
--   * Password columns are never added anywhere.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Drop legacy pool stub (unused; stored plaintext secrets — must not ship)
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS `campaign_sending_accounts`;

-- ----------------------------------------------------------------------------
-- 2. Campaign account pool (one row = account membership + weight)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `campaign_account_pools` (
  `id`              CHAR(36)     NOT NULL PRIMARY KEY,
  `campaign_id`     CHAR(36)     NOT NULL,
  `organization_id` CHAR(36)     NOT NULL,
  `smtp_account_id` CHAR(36)     NOT NULL,
  `weight`          INT          NOT NULL DEFAULT 100,
  `enabled`         TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `uq_pool_campaign_account` UNIQUE (`campaign_id`, `smtp_account_id`),
  CONSTRAINT `fk_pool_campaign`
    FOREIGN KEY (`campaign_id`) REFERENCES `campaigns` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_pool_account`
    FOREIGN KEY (`smtp_account_id`) REFERENCES `smtp_accounts` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_pool_org`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX `idx_pool_account` ON `campaign_account_pools` (`smtp_account_id`);
CREATE INDEX `idx_pool_org` ON `campaign_account_pools` (`organization_id`);

-- ----------------------------------------------------------------------------
-- 3. Campaign strategy columns
-- ----------------------------------------------------------------------------
ALTER TABLE `campaigns`
  ADD COLUMN `account_distribution` VARCHAR(20) NOT NULL DEFAULT 'round_robin',
  ADD COLUMN `account_stickiness`   VARCHAR(10) NOT NULL DEFAULT 'rotate',
  ADD COLUMN `fallback_policy`      VARCHAR(20) NOT NULL DEFAULT 'reassign';

-- ----------------------------------------------------------------------------
-- 4. Recipient-level assignment columns on campaign_leads
-- ----------------------------------------------------------------------------
ALTER TABLE `campaign_leads`
  ADD COLUMN `sending_account_id` CHAR(36) NULL,
  ADD COLUMN `assignment_method`  VARCHAR(20) NULL,
  ADD COLUMN `assigned_at`        DATETIME NULL;

CREATE INDEX `idx_campaign_leads_account` ON `campaign_leads` (`sending_account_id`);

-- ----------------------------------------------------------------------------
-- 5. Atomic quota reservation table (day + hour periods, UTC keys)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sending_account_usage` (
  `id`              CHAR(36)     NOT NULL PRIMARY KEY,
  `smtp_account_id` CHAR(36)     NOT NULL,
  `period_type`     VARCHAR(10)  NOT NULL,
  `period_key`      VARCHAR(20)  NOT NULL,
  `used`            INT          NOT NULL DEFAULT 0,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `uq_usage_account_period` UNIQUE (`smtp_account_id`, `period_type`, `period_key`),
  CONSTRAINT `fk_usage_account`
    FOREIGN KEY (`smtp_account_id`) REFERENCES `smtp_accounts` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 6. smtp_accounts: health / warmup / timezone / schedule / last_sent_at
-- ----------------------------------------------------------------------------
ALTER TABLE `smtp_accounts`
  ADD COLUMN `health_status`      VARCHAR(20) NOT NULL DEFAULT 'unknown',
  ADD COLUMN `warmup_status`      VARCHAR(20) NOT NULL DEFAULT 'not_started',
  ADD COLUMN `warmup_daily_limit` INT NULL,
  ADD COLUMN `timezone`           VARCHAR(64) NOT NULL DEFAULT 'UTC',
  ADD COLUMN `sending_schedule`   JSON NULL,
  ADD COLUMN `last_sent_at`       DATETIME NULL,
  ADD COLUMN `minimum_wait_minutes` INT NOT NULL DEFAULT 1;

-- ----------------------------------------------------------------------------
-- 7. email_jobs: account attribution + idempotency key
-- ----------------------------------------------------------------------------
ALTER TABLE `email_jobs`
  ADD COLUMN `sending_account_id` CHAR(36) NULL,
  ADD COLUMN `idempotency_key`    VARCHAR(255) NULL,
  ADD UNIQUE INDEX `uq_email_jobs_idempotency` (`idempotency_key`);

CREATE INDEX `idx_email_jobs_account_sent` ON `email_jobs` (`sending_account_id`, `status`, `sent_at`);

-- ----------------------------------------------------------------------------
-- 8. email_events: account / step / variant attribution
-- ----------------------------------------------------------------------------
ALTER TABLE `email_events`
  ADD COLUMN `sending_account_id` CHAR(36) NULL,
  ADD COLUMN `sequence_step_id`   CHAR(36) NULL,
  ADD COLUMN `variant_id`         CHAR(36) NULL;

CREATE INDEX `idx_email_events_account` ON `email_events` (`sending_account_id`, `event_type`);

-- ----------------------------------------------------------------------------
-- 9. Audit log (§68) — append-only; never stores secrets
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id`              CHAR(36)     NOT NULL PRIMARY KEY,
  `organization_id` CHAR(36)     NOT NULL,
  `actor_id`        CHAR(36)     NULL,
  `action`          VARCHAR(80)  NOT NULL,
  `entity_type`     VARCHAR(40)  NULL,
  `entity_id`       VARCHAR(64)  NULL,
  `details`         JSON         NULL,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_audit_org`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX `idx_audit_org_created` ON `audit_logs` (`organization_id`, `created_at`);
