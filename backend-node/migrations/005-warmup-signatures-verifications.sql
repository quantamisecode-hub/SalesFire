-- ============================================================================
-- PROMPT 9.1 / production parity — tables created only via dev `sequelize.sync()`
-- Production (MySQL 8) must apply this migration.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `warmup_plans` (
  `id`                       CHAR(36)     NOT NULL PRIMARY KEY,
  `organization_id`          CHAR(36)     NOT NULL,
  `account_id`               CHAR(36)     NOT NULL,
  `status`                   VARCHAR(20)  NOT NULL DEFAULT 'active',
  `start_volume`             INT          NOT NULL DEFAULT 2,
  `ramp_step`                INT          NOT NULL DEFAULT 2,
  `target_volume`            INT          NOT NULL DEFAULT 40,
  `started_on`               DATE         NOT NULL DEFAULT (CURRENT_DATE),
  `disabled_at`              DATETIME     NULL,
  `sent_today`               INT          NOT NULL DEFAULT 0,
  `sent_today_date`          DATE         NULL,
  `total_sent`               INT          NOT NULL DEFAULT 0,
  `total_failed`             INT          NOT NULL DEFAULT 0,
  `seed_recipients`          TEXT         NULL,
  `consecutive_failure_days` INT          NOT NULL DEFAULT 0,
  `created_at`               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `uq_warmup_account` UNIQUE (`account_id`),
  CONSTRAINT `fk_warmup_account`
    FOREIGN KEY (`account_id`) REFERENCES `smtp_accounts` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_warmup_org`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX `idx_warmup_org_status` ON `warmup_plans` (`organization_id`, `status`);

CREATE TABLE IF NOT EXISTS `email_signatures` (
  `id`              CHAR(36)      NOT NULL PRIMARY KEY,
  `organization_id` CHAR(36)      NOT NULL,
  `name`            VARCHAR(120)  NOT NULL,
  `html`            TEXT          NOT NULL,
  `text`            TEXT          NOT NULL DEFAULT '',
  `is_org_default`  TINYINT(1)    NOT NULL DEFAULT 0,
  `created_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_sig_org`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX `idx_sig_org` ON `email_signatures` (`organization_id`, `is_org_default`);

CREATE TABLE IF NOT EXISTS `email_verifications` (
  `id`              CHAR(36)     NOT NULL PRIMARY KEY,
  `organization_id` CHAR(36)     NOT NULL,
  `lead_id`         CHAR(36)     NULL,
  `email`           VARCHAR(320) NOT NULL,
  `status`          VARCHAR(20)  NOT NULL DEFAULT 'unknown',
  `risk_score`      INT          NOT NULL DEFAULT 100,
  `reasons`         JSON         NOT NULL,
  `duration_ms`     INT          NOT NULL DEFAULT 0,
  `mx_records`      JSON         NULL,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_everif_org`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX `idx_everif_org_email` ON `email_verifications` (`organization_id`, `email`);
CREATE INDEX `idx_everif_org_status` ON `email_verifications` (`organization_id`, `status`);
