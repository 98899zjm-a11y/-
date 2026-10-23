CREATE TABLE IF NOT EXISTS staff_capabilities (
 staff_id TEXT PRIMARY KEY NOT NULL REFERENCES staff_users(id),data TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workplace_messages (
 id TEXT PRIMARY KEY NOT NULL,text TEXT NOT NULL,author_id TEXT NOT NULL REFERENCES staff_users(id),
 author_name TEXT NOT NULL,created_at TEXT NOT NULL,deleted_at TEXT,deleted_by TEXT
);
CREATE INDEX IF NOT EXISTS workplace_messages_time ON workplace_messages(created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS private_notes (
 id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL REFERENCES staff_users(id),title TEXT NOT NULL,body TEXT NOT NULL,
 color TEXT NOT NULL,tag TEXT NOT NULL,due_at TEXT,pinned INTEGER NOT NULL,done INTEGER NOT NULL,
 archived INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS private_notes_owner ON private_notes(owner_id,archived,pinned,updated_at DESC);
CREATE TABLE IF NOT EXISTS inventory_report_batches (
 id TEXT PRIMARY KEY NOT NULL,content_hash TEXT NOT NULL UNIQUE,snapshot TEXT NOT NULL,from_date TEXT NOT NULL,to_date TEXT NOT NULL,
 title TEXT NOT NULL,note TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES staff_users(id),created_name TEXT NOT NULL,created_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('pending','approved','rejected')),revision INTEGER NOT NULL DEFAULT 1,
 reviewed_by TEXT,reviewed_name TEXT,reviewed_at TEXT,review_comment TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS inventory_report_batches_status ON inventory_report_batches(status,created_at DESC);
CREATE TABLE IF NOT EXISTS sales_publications (
 id TEXT PRIMARY KEY NOT NULL,month TEXT NOT NULL,content_hash TEXT NOT NULL UNIQUE,snapshot TEXT NOT NULL,mappings TEXT NOT NULL DEFAULT '{}',
 status TEXT NOT NULL CHECK(status IN('draft','published')),revision INTEGER NOT NULL DEFAULT 1,version INTEGER,
 created_by TEXT NOT NULL REFERENCES staff_users(id),created_name TEXT NOT NULL,created_at TEXT NOT NULL,
 published_by TEXT,published_name TEXT,published_at TEXT,review_note TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS sales_publications_version ON sales_publications(month,version) WHERE status='published';
CREATE INDEX IF NOT EXISTS sales_publications_month ON sales_publications(month,status,version DESC);
CREATE TABLE IF NOT EXISTS ledger_staff_mappings (
 source_instance TEXT NOT NULL,salesperson_key TEXT NOT NULL,staff_id TEXT NOT NULL REFERENCES staff_users(id),
 updated_by TEXT NOT NULL REFERENCES staff_users(id),updated_at TEXT NOT NULL,PRIMARY KEY(source_instance,salesperson_key)
);
