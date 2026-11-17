-- ============================================================================
-- Prompt (Sequence Builder) — MySQL 8 migration
--
-- Adds the visual email sequence builder storage:
--   * campaign_step_variants — A/B variants per step (weight = distribution %)
--   * campaign_steps.delay_minutes — minutes/hours/days wait configuration
--
-- Dev (SQLite) uses `sequelize.sync()`; production (MySQL 8) must apply THIS
-- migration. Run with any MySQL migration runner, e.g.:
--   mysql -u admin -p salesfire < migrations/003-sequence-builder.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Step variants (§9, §10, §42) — each step may hold Variant A/B/C...
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `campaign_step_variants` (
  `id`              CHAR(36)     NOT NULL PRIMARY KEY,
  `step_id`         CHAR(36)     NOT NULL,
  `organization_id` CHAR(36)     NULL,
  `variant_name`    VARCHAR(50)  NOT NULL DEFAULT 'Variant A',
  `variant_order`   INT          NOT NULL DEFAULT 0,
  `subject`         VARCHAR(500) NOT NULL DEFAULT '',
  `body_html`       TEXT         NULL,
  `body_text`       TEXT         NULL,
  -- Relative A/B distribution share; normalized against sibling variants.
  -- The API validates that a step's weights total 100% (§10).
  `weight`          INT          NOT NULL DEFAULT 50,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_step_variants_step`
    FOREIGN KEY (`step_id`) REFERENCES `campaign_steps` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_step_variants_organization`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX `idx_step_variants_step` ON `campaign_step_variants` (`step_id`);
CREATE INDEX `idx_step_variants_org_step` ON `campaign_step_variants` (`organization_id`, `step_id`);

-- ----------------------------------------------------------------------------
-- 2. Wait configuration in minutes (§7) — minutes/hours/days supported.
-- ----------------------------------------------------------------------------
ALTER TABLE `campaign_steps`
  ADD COLUMN `delay_minutes` INT NOT NULL DEFAULT 0 AFTER `delay_hours`;
