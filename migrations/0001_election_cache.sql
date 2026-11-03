CREATE TABLE `election_cache` (
	`id` integer PRIMARY KEY NOT NULL,
	`attempt_at` integer DEFAULT -60000 NOT NULL,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`snapshot` text
);
--> statement-breakpoint
CREATE TABLE `election_feeds` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
