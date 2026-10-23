-- New submitted sales orders are independent of old quotation confirmations
-- and monthly financial publications. No historical row is migrated or posted.
CREATE TABLE IF NOT EXISTS sales_order_sequences (
 business_date TEXT PRIMARY KEY NOT NULL,
 last_value INTEGER NOT NULL CHECK(last_value BETWEEN 1 AND 999999)
);
CREATE TABLE IF NOT EXISTS sales_orders (
 id TEXT PRIMARY KEY NOT NULL,
 number TEXT NOT NULL UNIQUE,
 owner_id TEXT NOT NULL REFERENCES staff_users(id),
 owner_name TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES staff_users(id),
 created_name TEXT NOT NULL,
 source_quote_id TEXT NOT NULL REFERENCES quotes(id),
 source_root_id TEXT NOT NULL,
 source_quote_version INTEGER NOT NULL CHECK(source_quote_version>=1),
 source_hash TEXT NOT NULL,
 customer_id TEXT NOT NULL REFERENCES customers(id),
 customer_name TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN('sale','custom','tradein')),
 business_date TEXT NOT NULL,
 snapshot_json TEXT NOT NULL,
 totals_json TEXT NOT NULL,
 amount_cents TEXT NOT NULL,
 weight_micros TEXT NOT NULL,
 item_count INTEGER NOT NULL CHECK(item_count>=1),
 note TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK(status IN('pending','approved','rejected','voided')),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 content_hash TEXT NOT NULL,
 request_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 created_at TEXT NOT NULL,
 submitted_at TEXT NOT NULL,
 reviewed_by TEXT REFERENCES staff_users(id),
 reviewed_name TEXT,
 reviewed_at TEXT,
 review_note TEXT NOT NULL DEFAULT '',
 voided_by TEXT REFERENCES staff_users(id),
 voided_name TEXT,
 voided_at TEXT,
 void_note TEXT NOT NULL DEFAULT '',
 previous_id TEXT REFERENCES sales_orders(id),
 UNIQUE(created_by,request_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_orders_effective_root ON sales_orders(source_root_id) WHERE status IN('pending','approved');
CREATE INDEX IF NOT EXISTS sales_orders_owner_month ON sales_orders(owner_id,business_date,status,submitted_at DESC,id);
CREATE INDEX IF NOT EXISTS sales_orders_review_queue ON sales_orders(status,submitted_at DESC,id);
CREATE INDEX IF NOT EXISTS sales_orders_source_history ON sales_orders(source_root_id,submitted_at DESC,id);
CREATE TABLE IF NOT EXISTS sales_order_events (
 id TEXT PRIMARY KEY NOT NULL,
 order_id TEXT NOT NULL REFERENCES sales_orders(id),
 actor_id TEXT NOT NULL REFERENCES staff_users(id),
 actor_name TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN('create','approve','reject','void')),
 from_status TEXT,
 to_status TEXT NOT NULL CHECK(to_status IN('pending','approved','rejected','voided')),
 revision INTEGER NOT NULL CHECK(revision>=1),
 content_hash TEXT NOT NULL,
 request_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,
 UNIQUE(actor_id,request_id)
);
CREATE INDEX IF NOT EXISTS sales_order_events_history ON sales_order_events(order_id,revision,created_at,id);
CREATE TRIGGER IF NOT EXISTS sales_order_no_delete BEFORE DELETE ON sales_orders BEGIN SELECT RAISE(ABORT,'Sales order history must be retained'); END;
CREATE TRIGGER IF NOT EXISTS sales_order_source_immutable BEFORE UPDATE OF number,owner_id,owner_name,created_by,created_name,source_quote_id,source_root_id,source_quote_version,source_hash,customer_id,customer_name,type,business_date,snapshot_json,totals_json,amount_cents,weight_micros,item_count,note,content_hash,request_id,request_hash,created_at,submitted_at,previous_id ON sales_orders BEGIN SELECT RAISE(ABORT,'Submitted sales order source is immutable'); END;
CREATE TRIGGER IF NOT EXISTS sales_order_event_no_delete BEFORE DELETE ON sales_order_events BEGIN SELECT RAISE(ABORT,'Sales order events must be retained'); END;
CREATE TRIGGER IF NOT EXISTS sales_order_event_no_update BEFORE UPDATE ON sales_order_events BEGIN SELECT RAISE(ABORT,'Sales order events are immutable'); END;
