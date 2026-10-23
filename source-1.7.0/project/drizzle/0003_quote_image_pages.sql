CREATE TABLE quote_image_uploads (
  quote_id TEXT PRIMARY KEY NOT NULL REFERENCES quotes(id),
  total_pages INTEGER NOT NULL CHECK(total_pages BETWEEN 1 AND 30),
  created_by TEXT NOT NULL REFERENCES staff_users(id),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE quote_image_pages (
  quote_id TEXT NOT NULL REFERENCES quote_image_uploads(quote_id),
  page_index INTEGER NOT NULL CHECK(page_index BETWEEN 0 AND 29),
  image_url TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES staff_users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(quote_id,page_index)
);
