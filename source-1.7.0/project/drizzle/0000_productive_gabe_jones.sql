CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_logs` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `company_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `customer_owner_idx` ON `customers` (`owner_id`);--> statement-breakpoint
CREATE TABLE `quote_attachments` (
	`quote_id` text PRIMARY KEY NOT NULL,
	`images` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`type` text NOT NULL,
	`customer_id` text NOT NULL,
	`customer_name` text NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`snapshot` text NOT NULL,
	`totals` text NOT NULL,
	`total_cents` integer NOT NULL,
	`root_id` text NOT NULL,
	`base_quote_id` text,
	`version` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quote_number_unique` ON `quotes` (`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `quote_version_unique` ON `quotes` (`root_id`,`version`);--> statement-breakpoint
CREATE INDEX `quote_owner_date_idx` ON `quotes` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `quote_customer_idx` ON `quotes` (`customer_id`);--> statement-breakpoint
CREATE TABLE `staff_users` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_user_identity_unique` ON `staff_users` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `staff_user_email_unique` ON `staff_users` (`email`);--> statement-breakpoint
CREATE TABLE `styles` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
