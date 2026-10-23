ALTER TABLE customers ADD COLUMN phone_key TEXT;
ALTER TABLE customers ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX customer_active_phone_key ON customers(phone_key) WHERE deleted_at IS NULL AND phone_key IS NOT NULL;
CREATE TABLE customer_collaborators(
 customer_id TEXT NOT NULL REFERENCES customers(id),staff_id TEXT NOT NULL REFERENCES staff_users(id),
 active INTEGER NOT NULL,granted_by TEXT NOT NULL REFERENCES staff_users(id),granted_at TEXT NOT NULL,
 revoked_by TEXT REFERENCES staff_users(id),revoked_at TEXT,PRIMARY KEY(customer_id,staff_id));
CREATE TABLE customer_identity_conflicts(phone_key TEXT PRIMARY KEY,customer_ids TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',detected_at TEXT NOT NULL);
