CREATE TABLE IF NOT EXISTS module_permissions (
 staff_id TEXT PRIMARY KEY NOT NULL REFERENCES staff_users(id),
 sales TEXT NOT NULL DEFAULT 'operate' CHECK(sales IN('disabled','view','operate','manage')),
 ledger TEXT NOT NULL DEFAULT 'disabled' CHECK(ledger IN('disabled','view','operate','manage')),
 inventory TEXT NOT NULL DEFAULT 'disabled' CHECK(inventory IN('disabled','view','operate','manage')),
 revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS administration_meta (name TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operation_logs (
 id TEXT PRIMARY KEY NOT NULL,created_at TEXT NOT NULL,actor_id TEXT,actor_name TEXT NOT NULL,
 module TEXT NOT NULL,action TEXT NOT NULL,label TEXT NOT NULL,resource TEXT NOT NULL,
 success INTEGER NOT NULL,status INTEGER NOT NULL,summary TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS operation_logs_time ON operation_logs(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS operation_logs_actor ON operation_logs(actor_id,created_at DESC);
CREATE TABLE IF NOT EXISTS usage_sessions (
 id TEXT PRIMARY KEY NOT NULL,staff_id TEXT NOT NULL REFERENCES staff_users(id),
 started_at TEXT NOT NULL,last_seen TEXT NOT NULL,last_module TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 0,ended_at TEXT,ended_reason TEXT
);
CREATE INDEX IF NOT EXISTS usage_sessions_staff ON usage_sessions(staff_id,last_seen DESC);
CREATE TABLE IF NOT EXISTS usage_intervals (
 id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT NOT NULL REFERENCES usage_sessions(id),
 staff_id TEXT NOT NULL REFERENCES staff_users(id),started_at TEXT NOT NULL,ended_at TEXT NOT NULL,
 online_seconds REAL NOT NULL,active_seconds REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_intervals_time ON usage_intervals(ended_at,started_at);
CREATE TABLE IF NOT EXISTS login_failures (
 key TEXT PRIMARY KEY NOT NULL,window_start INTEGER NOT NULL,failures INTEGER NOT NULL,
 blocked_until INTEGER NOT NULL,last_failed INTEGER NOT NULL
);
