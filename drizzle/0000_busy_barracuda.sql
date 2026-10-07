CREATE TABLE `blueprints` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`points` text DEFAULT '[]' NOT NULL,
	`application` text DEFAULT '[]' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`image_key` text,
	`source_key` text,
	`source_name` text,
	`source_mime` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `blueprints_status` ON `blueprints` (`status`);--> statement-breakpoint
CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`visitor` text NOT NULL,
	`blueprint_id` text,
	`messages` text DEFAULT '[]' NOT NULL,
	`sources` text DEFAULT '[]' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`lease` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`last_request` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quotas` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
