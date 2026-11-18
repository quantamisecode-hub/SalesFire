-- ============================================================================
-- Migration 006 — Instantly lead-parity: lead owner, extended statuses,
-- CRM holding lists. Production (MySQL 8) must apply this migration.
-- Dev (SQLite) applies the equivalent via scripts/migrate-sqlite.js.
-- ============================================================================

-- 1. Lead owner (Instantly lead-owner parity). Nullable; no backfill.
-- NOTE: MySQL 8 does not support ADD COLUMN IF NOT EXISTS — run on a fresh database or drop the column guard as appropriate.
ALTER TABLE `leads`
  ADD COLUMN `assigned_to` CHAR(36) NULL;
ALTER TABLE `leads`
  ADD CONSTRAINT `fk_leads_assigned_to`
    FOREIGN KEY (`assigned_to`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
-- NOTE: MySQL 8 has no CREATE INDEX IF NOT EXISTS — a duplicate name errors; pick fresh index names if re-running.
CREATE INDEX `idx_leads_assigned_to` ON `leads` (`organization_id`, `assigned_to`);

-- 2. Extended lead statuses (manual interest signals; progression kept).
--    MySQL ENUM must be widened explicitly. NOTE: values must match models/lead.js LEAD_STATUSES.
ALTER TABLE `leads`
  MODIFY COLUMN `status` ENUM(
    'new','approved','contacted','replied','bounced','unsubscribed','suppressed','invalid',
    'completed',
    'interested','meeting_completed','meeting_completed_not_closed',
    'won','lost','not_interested','out_of_office','wrong_person'
  ) NOT NULL DEFAULT 'new';

-- 3. CRM holding lists (Instantly CRM Lists parity).
CREATE TABLE IF NOT EXISTS `lead_lists` (
  `id`               CHAR(36)     NOT NULL PRIMARY KEY,
  `organization_id`  CHAR(36)     NOT NULL,
  `name`             VARCHAR(255) NOT NULL,
  `description`      TEXT         NULL,
  `created_by`       CHAR(36)     NULL,
  `created_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `uq_lead_lists_org_name` UNIQUE (`organization_id`, `name`),
  CONSTRAINT `fk_lead_lists_org`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_lead_lists_created_by`
    FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX `idx_lead_lists_org` ON `lead_lists` (`organization_id`);

CREATE TABLE IF NOT EXISTS `lead_list_members` (
  `id`               CHAR(36)  NOT NULL PRIMARY KEY,
  `list_id`          CHAR(36)  NOT NULL,
  `lead_id`          CHAR(36)  NOT NULL,
  `organization_id`  CHAR(36)  NOT NULL,
  `added_by`         CHAR(36)  NULL,
  `created_at`       DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `uq_lead_list_members_pair` UNIQUE (`list_id`, `lead_id`),
  CONSTRAINT `fk_lead_list_members_list`
    FOREIGN KEY (`list_id`) REFERENCES `lead_lists` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_lead_list_members_lead`
    FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_lead_list_members_org`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX `idx_lead_list_members_lead` ON `lead_list_members` (`lead_id`);
CREATE INDEX `idx_lead_list_members_org`  ON `lead_list_members` (`organization_id`);
