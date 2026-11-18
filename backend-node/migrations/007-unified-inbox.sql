-- ============================================================================
-- Migration 007 — Unified Inbox: conversations, messages, sync state, drafts,
-- insights, notifications, IMAP credentials on sending accounts.
-- Production (MySQL 8) must apply this migration. Dev applies the equivalent
-- via scripts/migrate-sqlite.js.
-- ============================================================================

ALTER TABLE `smtp_accounts`
  ADD COLUMN `imap_host` VARCHAR(255) NULL,
  ADD COLUMN `imap_port` INT NULL DEFAULT 993,
  ADD COLUMN `imap_secure` TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN `imap_username` VARCHAR(255) NULL,
  ADD COLUMN `imap_password_encrypted` TEXT NULL,
  ADD COLUMN `imap_enabled` TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS `conversations` (
  `id`                 CHAR(36)     NOT NULL PRIMARY KEY,
  `organization_id`    CHAR(36)     NOT NULL,
  `subject`            VARCHAR(500) NOT NULL DEFAULT '(no subject)',
  `status`             VARCHAR(30)  NOT NULL DEFAULT 'open',
  `lead_id`            CHAR(36)     NULL,
  `campaign_id`        CHAR(36)     NULL,
  `sequence_id`        CHAR(36)     NULL,
  `sequence_step_id`   CHAR(36)     NULL,
  `sending_account_id` CHAR(36)     NULL,
  `assigned_user_id`   CHAR(36)     NULL,
  `last_message_at`    DATETIME     NULL,
  `last_inbound_at`    DATETIME     NULL,
  `last_outbound_at`   DATETIME     NULL,
  `is_starred`         TINYINT(1)   NOT NULL DEFAULT 0,
  `is_archived`        TINYINT(1)   NOT NULL DEFAULT 0,
  `snoozed_until`      DATETIME     NULL,
  `tags`               JSON         NULL,
  `thread_status`      VARCHAR(20)  NOT NULL DEFAULT 'matched',
  `created_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_conversations_org`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_conversations_lead`
    FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX `idx_conversations_org_status`       ON `conversations` (`organization_id`, `status`);
CREATE INDEX `idx_conversations_org_assignee`     ON `conversations` (`organization_id`, `assigned_user_id`);
CREATE INDEX `idx_conversations_org_last_msg`     ON `conversations` (`organization_id`, `last_message_at`);
CREATE INDEX `idx_conversations_org_campaign`     ON `conversations` (`organization_id`, `campaign_id`);
CREATE INDEX `idx_conversations_org_lead`         ON `conversations` (`organization_id`, `lead_id`);
CREATE INDEX `idx_conversations_org_account`      ON `conversations` (`organization_id`, `sending_account_id`);
CREATE INDEX `idx_conversations_org_archive_msg`  ON `conversations` (`organization_id`, `is_archived`, `last_message_at`);
CREATE INDEX `idx_conversations_org_snooze`       ON `conversations` (`organization_id`, `snoozed_until`);

CREATE TABLE IF NOT EXISTS `email_messages` (
  `id`                 CHAR(36)     NOT NULL PRIMARY KEY,
  `organization_id`    CHAR(36)     NOT NULL,
  `conversation_id`    CHAR(36)     NOT NULL,
  `message_id`         VARCHAR(500) NOT NULL,
  `in_reply_to`        VARCHAR(500) NULL,
  `references`         JSON         NULL,
  `direction`          VARCHAR(10)  NOT NULL,
  `from_email`         VARCHAR(255) NULL,
  `from_name`          VARCHAR(255) NULL,
  `to_emails`          JSON         NULL,
  `cc_emails`          JSON         NULL,
  `bcc_emails`         JSON         NULL,
  `subject`            VARCHAR(500) NULL,
  `text_body`          MEDIUMTEXT   NULL,
  `html_body`          MEDIUMTEXT   NULL,
  `snippet`            VARCHAR(255) NULL,
  `headers`            JSON         NULL,
  `sent_at`            DATETIME     NULL,
  `received_at`        DATETIME     NULL,
  `status`             VARCHAR(20)  NOT NULL DEFAULT 'received',
  `is_read`            TINYINT(1)   NOT NULL DEFAULT 0,
  `message_type`       VARCHAR(20)  NOT NULL DEFAULT 'UNKNOWN',
  `provider_message_id` VARCHAR(500) NULL,
  `mailbox_uid`        BIGINT       NULL,
  `provider_name`      VARCHAR(20)  NULL DEFAULT 'imap',
  `sending_account_id` CHAR(36)     NULL,
  `lead_id`            CHAR(36)     NULL,
  `campaign_id`        CHAR(36)     NULL,
  `sequence_id`        CHAR(36)     NULL,
  `sequence_step_id`   CHAR(36)     NULL,
  `idempotency_key`    VARCHAR(255) NULL,
  `created_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `uq_email_messages_org_message_id` UNIQUE (`organization_id`, `message_id`),
  CONSTRAINT `uq_email_messages_idempotency`    UNIQUE (`idempotency_key`),
  CONSTRAINT `fk_email_messages_org`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_email_messages_conversation`
    FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_email_messages_lead`
    FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX `idx_email_messages_conversation_created` ON `email_messages` (`conversation_id`, `created_at`);
CREATE INDEX `idx_email_messages_conversation_read`    ON `email_messages` (`conversation_id`, `is_read`);
CREATE INDEX `idx_email_messages_org_campaign`         ON `email_messages` (`organization_id`, `campaign_id`);
CREATE INDEX `idx_email_messages_org_lead`             ON `email_messages` (`organization_id`, `lead_id`);
CREATE INDEX `idx_email_messages_org_account`          ON `email_messages` (`organization_id`, `sending_account_id`);
CREATE INDEX `idx_email_messages_org_received`         ON `email_messages` (`organization_id`, `received_at`);

CREATE TABLE IF NOT EXISTS `mailbox_sync_states` (
  `id`                       CHAR(36)     NOT NULL PRIMARY KEY,
  `organization_id`          CHAR(36)     NOT NULL,
  `sending_account_id`       CHAR(36)     NOT NULL,
  `provider`                 VARCHAR(20)  NOT NULL DEFAULT 'imap',
  `last_uid`                 BIGINT       NULL,
  `uid_validity`             BIGINT       NULL,
  `last_sync_at`             DATETIME     NULL,
  `last_successful_sync_at`  DATETIME     NULL,
  `status`                   VARCHAR(20)  NOT NULL DEFAULT 'idle',
  `error_code`               VARCHAR(60)  NULL,
  `error_message`            VARCHAR(500) NULL,
  `consecutive_failures`     INT          NOT NULL DEFAULT 0,
  `created_at`               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`               DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `uq_mailbox_sync_org_account` UNIQUE (`organization_id`, `sending_account_id`),
  CONSTRAINT `fk_mailbox_sync_org`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_mailbox_sync_account`
    FOREIGN KEY (`sending_account_id`) REFERENCES `smtp_accounts` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `conversation_drafts` (
  `id`                 CHAR(36) NOT NULL PRIMARY KEY,
  `organization_id`    CHAR(36) NOT NULL,
  `conversation_id`    CHAR(36) NOT NULL,
  `user_id`            CHAR(36) NOT NULL,
  `to_emails`          JSON     NULL,
  `cc_emails`          JSON     NULL,
  `bcc_emails`         JSON     NULL,
  `subject`            VARCHAR(500) NULL,
  `text_body`          MEDIUMTEXT   NULL,
  `html_body`          MEDIUMTEXT   NULL,
  `sending_account_id` CHAR(36) NULL,
  `signature_id`       CHAR(36) NULL,
  `created_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `uq_draft_conversation_user` UNIQUE (`conversation_id`, `user_id`),
  CONSTRAINT `fk_draft_org`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_draft_conversation`
    FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `conversation_insights` (
  `id`                 CHAR(36) NOT NULL PRIMARY KEY,
  `organization_id`    CHAR(36) NOT NULL,
  `conversation_id`    CHAR(36) NOT NULL,
  `type`               VARCHAR(30) NOT NULL,
  `value`              TEXT     NOT NULL,
  `confidence`         FLOAT    NOT NULL DEFAULT 0.5,
  `source_message_id`  CHAR(36) NULL,
  `model`              VARCHAR(120) NULL,
  `created_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_insights_org`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_insights_conversation`
    FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX `idx_insights_conversation_created` ON `conversation_insights` (`conversation_id`, `created_at`);

CREATE TABLE IF NOT EXISTS `notifications` (
  `id`                 CHAR(36) NOT NULL PRIMARY KEY,
  `organization_id`    CHAR(36) NOT NULL,
  `user_id`            CHAR(36) NOT NULL,
  `type`               VARCHAR(40) NOT NULL,
  `title`              VARCHAR(255) NOT NULL,
  `body`               VARCHAR(1000) NULL,
  `conversation_id`    CHAR(36) NULL,
  `is_read`            TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_notifications_org`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_notifications_user`
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE INDEX `idx_notifications_org_user_read` ON `notifications` (`organization_id`, `user_id`, `is_read`);
CREATE INDEX `idx_notifications_org_created`   ON `notifications` (`organization_id`, `created_at`);
