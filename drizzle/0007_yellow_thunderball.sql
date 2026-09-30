ALTER TABLE `offers` ADD `flagged` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `offers` ADD `flag_reason` text;--> statement-breakpoint
ALTER TABLE `offers` ADD `flag_reviewed_at` integer;--> statement-breakpoint
CREATE INDEX `offers_flagged_idx` ON `offers` (`flagged`,`flag_reviewed_at`);