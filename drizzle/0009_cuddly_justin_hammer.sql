CREATE TABLE `contact_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`topic` text NOT NULL,
	`listing_id` text,
	`body` text NOT NULL,
	`handled_at` integer,
	`handled_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `contact_requests_open_idx` ON `contact_requests` (`handled_at`,`created_at`);--> statement-breakpoint
ALTER TABLE `listings` ADD `cms_attempted_at` integer;