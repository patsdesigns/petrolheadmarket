CREATE TABLE `listing_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`position` integer NOT NULL,
	`width` integer,
	`height` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `listing_photos_listing_idx` ON `listing_photos` (`listing_id`,`position`);--> statement-breakpoint
CREATE TABLE `listings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`year` integer,
	`make` text,
	`model` text,
	`body_style` text,
	`engine` text,
	`transmission` text,
	`drivetrain` text,
	`exterior_color` text,
	`interior_color` text,
	`mileage` integer,
	`vin` text,
	`headline` text,
	`description` text,
	`highlights` text,
	`known_issues` text,
	`modifications` text,
	`service_history` text,
	`owner_count` integer,
	`title_status` text,
	`title_state` text,
	`records_on_file` integer DEFAULT false NOT NULL,
	`video_url` text,
	`price` integer,
	`accepts_offers` integer DEFAULT true NOT NULL,
	`location_city` text,
	`location_state` text,
	`contact_method` text DEFAULT 'messages' NOT NULL,
	`contact_phone` text,
	`seller_type` text DEFAULT 'private' NOT NULL,
	`verified_seller` integer DEFAULT false NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`slug` text,
	`cms_item_id` text,
	`review_notes` text,
	`reviewer_id` text,
	`submitted_at` integer,
	`reviewed_at` integer,
	`published_at` integer,
	`sold_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `listings_slug_unique` ON `listings` (`slug`);--> statement-breakpoint
CREATE INDEX `listings_user_idx` ON `listings` (`user_id`);--> statement-breakpoint
CREATE INDEX `listings_status_idx` ON `listings` (`status`,`submitted_at`);