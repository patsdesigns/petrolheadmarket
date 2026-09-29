CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`body` text NOT NULL,
	`flagged` integer DEFAULT false NOT NULL,
	`flag_reason` text,
	`flag_reviewed_at` integer,
	`read_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_thread_idx` ON `messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `messages_sender_idx` ON `messages` (`sender_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `messages_flagged_idx` ON `messages` (`flagged`,`flag_reviewed_at`);--> statement-breakpoint
CREATE TABLE `offers` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`buyer_id` text NOT NULL,
	`made_by` text DEFAULT 'buyer' NOT NULL,
	`amount` integer NOT NULL,
	`message` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`parent_offer_id` text,
	`expires_at` integer NOT NULL,
	`responded_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`buyer_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `offers_listing_idx` ON `offers` (`listing_id`,`status`);--> statement-breakpoint
CREATE INDEX `offers_buyer_idx` ON `offers` (`buyer_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`buyer_id` text NOT NULL,
	`seller_id` text NOT NULL,
	`last_message_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `listings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`buyer_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`seller_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `threads_listing_buyer_uq` ON `threads` (`listing_id`,`buyer_id`);--> statement-breakpoint
CREATE INDEX `threads_buyer_idx` ON `threads` (`buyer_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `threads_seller_idx` ON `threads` (`seller_id`,`last_message_at`);