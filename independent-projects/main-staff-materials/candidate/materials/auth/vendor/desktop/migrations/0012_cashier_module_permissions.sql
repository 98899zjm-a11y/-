-- Independent module authority; existing sales/ledger/inventory columns stay intact.
CREATE TABLE IF NOT EXISTS cashier_module_permissions (
 staff_id TEXT PRIMARY KEY NOT NULL REFERENCES staff_users(id),
 level TEXT NOT NULL DEFAULT 'disabled' CHECK(level IN('disabled','view','operate','manage')),
 updated_at TEXT NOT NULL
);
