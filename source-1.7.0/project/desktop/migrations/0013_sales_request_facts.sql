-- Immutable request/number knowledge in the same sales SQLite transaction.
-- Deliberately no FK to an effective order/quote: restore must retain a receipt
-- without reviving the business order that the user explicitly restored away.
CREATE TABLE IF NOT EXISTS sales_request_metadata (
 version INTEGER PRIMARY KEY NOT NULL CHECK(version=1)
);
INSERT OR IGNORE INTO sales_request_metadata(version) VALUES(1);
CREATE TABLE IF NOT EXISTS sales_request_facts (
 creator_id TEXT NOT NULL,
 request_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN('issued','cancelled')),
 request_hash TEXT,
 order_id TEXT UNIQUE,
 number TEXT UNIQUE,
 source_quote_id TEXT,
 source_hash TEXT,
 business_date TEXT,
 issued_at TEXT,
 cancelled_at TEXT,
 record_hash TEXT NOT NULL CHECK(length(record_hash)=64),
 PRIMARY KEY(creator_id,request_id),
 CHECK((state='issued' AND request_hash IS NOT NULL AND order_id IS NOT NULL AND number IS NOT NULL AND source_quote_id IS NOT NULL AND source_hash IS NOT NULL AND business_date IS NOT NULL AND issued_at IS NOT NULL AND cancelled_at IS NULL)
    OR (state='cancelled' AND request_hash IS NULL AND order_id IS NULL AND number IS NULL AND source_quote_id IS NULL AND source_hash IS NULL AND business_date IS NULL AND issued_at IS NULL AND cancelled_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS sales_request_issued_date ON sales_request_facts(business_date,number) WHERE state='issued';
CREATE TRIGGER IF NOT EXISTS sales_request_fact_no_update BEFORE UPDATE ON sales_request_facts BEGIN SELECT RAISE(ABORT,'Sales request knowledge is immutable'); END;
CREATE TRIGGER IF NOT EXISTS sales_request_fact_no_delete BEFORE DELETE ON sales_request_facts BEGIN SELECT RAISE(ABORT,'Sales request knowledge must be retained'); END;
CREATE TRIGGER IF NOT EXISTS sales_request_metadata_no_update BEFORE UPDATE ON sales_request_metadata BEGIN SELECT RAISE(ABORT,'Sales request schema identity is immutable'); END;
CREATE TRIGGER IF NOT EXISTS sales_request_metadata_no_delete BEFORE DELETE ON sales_request_metadata BEGIN SELECT RAISE(ABORT,'Sales request schema identity must be retained'); END;
