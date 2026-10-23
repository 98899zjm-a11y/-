ALTER TABLE quotes ADD COLUMN deleted_at TEXT;
--> statement-breakpoint
ALTER TABLE quotes ADD COLUMN deleted_by TEXT REFERENCES staff_users(id);
--> statement-breakpoint
ALTER TABLE customers ADD COLUMN deleted_at TEXT;
--> statement-breakpoint
ALTER TABLE customers ADD COLUMN deleted_by TEXT REFERENCES staff_users(id);
--> statement-breakpoint
CREATE INDEX quote_live_owner_date_idx ON quotes(deleted_at,owner_id,created_at);
--> statement-breakpoint
CREATE TABLE sale_confirmations (
  id TEXT PRIMARY KEY NOT NULL,
  root_id TEXT NOT NULL,
  quote_id TEXT NOT NULL REFERENCES quotes(id),
  owner_id TEXT NOT NULL REFERENCES staff_users(id),
  confirmed_by TEXT NOT NULL REFERENCES staff_users(id),
  confirmed_at TEXT NOT NULL,
  cancelled_at TEXT,
  cancelled_by TEXT REFERENCES staff_users(id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX sale_confirmation_active_root_idx ON sale_confirmations(root_id) WHERE cancelled_at IS NULL;
--> statement-breakpoint
CREATE INDEX sale_confirmation_month_idx ON sale_confirmations(cancelled_at,confirmed_at,owner_id);
--> statement-breakpoint
CREATE TABLE warranty_preferences (
  staff_id TEXT PRIMARY KEY NOT NULL REFERENCES staff_users(id),
  phone TEXT NOT NULL DEFAULT '',
  after_sales_wechat TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
