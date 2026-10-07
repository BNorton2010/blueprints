CREATE TABLE `strategist_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`lease` text,
	`lease_until` integer DEFAULT 0 NOT NULL
);
