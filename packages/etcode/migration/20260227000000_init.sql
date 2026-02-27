CREATE TABLE IF NOT EXISTS `session` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `directory` text NOT NULL,
  `title` text NOT NULL,
  `agent` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `session_project_idx` ON `session` (`project_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `message` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE CASCADE,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `message_session_idx` ON `message` (`session_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `part` (
  `id` text PRIMARY KEY NOT NULL,
  `message_id` text NOT NULL REFERENCES `message`(`id`) ON DELETE CASCADE,
  `session_id` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  `data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `part_message_idx` ON `part` (`message_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `part_session_idx` ON `part` (`session_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `todo` (
  `session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE CASCADE,
  `content` text NOT NULL,
  `status` text NOT NULL,
  `priority` text NOT NULL,
  `position` integer NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL,
  PRIMARY KEY (`session_id`, `position`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `todo_session_idx` ON `todo` (`session_id`);
