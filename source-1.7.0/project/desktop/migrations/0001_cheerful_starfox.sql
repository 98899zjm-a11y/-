CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`url` text NOT NULL,
	`owner_id` text NOT NULL,
	`owner_name` text NOT NULL,
	`created_at` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_asset_url_unique` ON `media_assets` (`url`);--> statement-breakpoint
CREATE INDEX `media_active_date_idx` ON `media_assets` (`active`,`created_at`);--> statement-breakpoint
CREATE TABLE `staff_preferences` (
	`staff_id` text PRIMARY KEY NOT NULL,
	`payment_methods` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`staff_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action
);
