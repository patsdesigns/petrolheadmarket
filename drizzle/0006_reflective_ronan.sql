CREATE TABLE `job_runs` (
	`name` text PRIMARY KEY NOT NULL,
	`ran_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `listings` ADD `publishing_at` integer;--> statement-breakpoint
ALTER TABLE `listings` ADD `cms_sync_pending` integer DEFAULT false NOT NULL;