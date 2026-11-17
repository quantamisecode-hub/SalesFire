-- ============================================================================
-- Prompt 6 (extension) — Leads management + import workflow: MySQL 8 migration
--
-- Adds the table-first Leads experience storage:
--   * leads        — one row per prospect (custom vars in custom_fields JSON)
--   * import_jobs  — durable import jobs with REAL progress counters and the
--                    parsed rows; the UI polls these during import (no fake
--                    progress anywhere).
--
-- Dev (SQLite) uses `sequelize.sync()`; production (MySQL 8) must apply THIS
-- migration. Run with any MySQL migration runner, e.g.:
--   mysql -u admin -p salesfire < migrations/002-leads-import.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Leads (§35) — exact field set from the import template + status/score.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `leads` (
  `id`              CHAR(36)     NOT NULL PRIMARY KEY,
  `organization_id` CHAR(36)     NOT NULL,
  `created_by`      CHAR(36)     NULL,
  `first_name`      VARCHAR(100) NULL,
  `last_name`       VARCHAR(100) NULL,
  `company_name`    VARCHAR(255) NULL,
  `job_title`       VARCHAR(255) NULL,
  `email`           VARCHAR(255) NOT NULL,
  `phone`           VARCHAR(50)  NULL,
  `website`         VARCHAR(255) NULL,
  `linkedin`        VARCHAR(255) NULL,
  `location`        VARCHAR(255) NULL,
  `industry`        VARCHAR(255) NULL,
  `company_size`    VARCHAR(50)  NULL,
  `personalization` TEXT         NULL,
  -- Flexible custom variables: {"recent_funding": "Series B", ...}
  -- become {{recent_funding}} template variables (§21).
  `custom_fields`   JSON         NULL,
  `status`          ENUM('new','approved','contacted','replied','bounced',
                         'unsubscribed','suppressed','invalid')
                    NOT NULL DEFAULT 'new',
  -- Email verification is separate from lead status — never claim "verified"
  -- from syntax/domain checks alone (§7).
  `email_status`    ENUM('unknown','discovered','syntax_valid','domain_valid',
                         'mx_valid','verified','invalid','bounced','unsubscribed')
                    NOT NULL DEFAULT 'unknown',
  -- Real ICP/lead score when scoring has been performed; NULL = "Not scored" (§8).
  `lead_score`      INT          NULL,
  `source`          VARCHAR(50)  NOT NULL DEFAULT 'manual',
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_leads_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `uq_leads_org_email` UNIQUE (`organization_id`, `email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tenant-aware indexes (§43) — every index leads with organization_id.
CREATE INDEX `idx_leads_org`                ON `leads` (`organization_id`);
CREATE INDEX `idx_leads_org_company`        ON `leads` (`organization_id`, `company_name`);
CREATE INDEX `idx_leads_org_status`         ON `leads` (`organization_id`, `status`);
CREATE INDEX `idx_leads_org_email_status`   ON `leads` (`organization_id`, `email_status`);
CREATE INDEX `idx_leads_org_lead_score`     ON `leads` (`organization_id`, `lead_score`);
CREATE INDEX `idx_leads_org_created_at`     ON `leads` (`organization_id`, `created_at`);

-- ----------------------------------------------------------------------------
-- 2. Import jobs (§28, §42) — upload → job → worker → batches → progress.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `import_jobs` (
  `id`                 CHAR(36)     NOT NULL PRIMARY KEY,
  `organization_id`    CHAR(36)     NOT NULL,
  `created_by`         CHAR(36)     NULL,
  -- pending | processing | completed | failed
  `status`             VARCHAR(20)  NOT NULL DEFAULT 'pending',
  -- Sanitized display name only — NEVER used to build filesystem paths (§39).
  `filename`           VARCHAR(255) NULL,
  `format`             VARCHAR(10)  NULL,
  -- { "columnIndex": "fieldName" | "custom:<slug>" | "skip" } (§20-21)
  `mapping`            JSON         NULL,
  -- skip | update
  `duplicate_strategy` VARCHAR(30)  NOT NULL DEFAULT 'skip',
  -- When set, imported leads are enrolled into this campaign's audience (§34).
  `campaign_id`        CHAR(36)     NULL,
  -- Parsed source rows (size and row count capped at upload time).
  `rows`               JSON         NULL,
  -- Real counters updated per batch — polled by the UI (§28).
  `total_rows`         INT          NOT NULL DEFAULT 0,
  `processed`          INT          NOT NULL DEFAULT 0,
  `imported`           INT          NOT NULL DEFAULT 0,
  `skipped`            INT          NOT NULL DEFAULT 0,
  `failed`             INT          NOT NULL DEFAULT 0,
  -- [{ row, email, reason }] for the downloadable error report (§30).
  `error_report`       JSON         NULL,
  `error_message`      VARCHAR(500) NULL,
  `created_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_import_jobs_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_import_jobs_campaign`
    FOREIGN KEY (`campaign_id`) REFERENCES `campaigns` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX `idx_import_jobs_org`        ON `import_jobs` (`organization_id`);
CREATE INDEX `idx_import_jobs_org_status` ON `import_jobs` (`organization_id`, `status`);
