ALTER TABLE `session` ADD COLUMN `summary_additions` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `session` ADD COLUMN `summary_deletions` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `session` ADD COLUMN `summary_files` integer DEFAULT 0;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `permission` (
  `project_id` text PRIMARY KEY NOT NULL,
  `data` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
