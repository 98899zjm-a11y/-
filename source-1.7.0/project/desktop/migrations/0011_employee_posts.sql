-- Company-visible employee stories only. No sales/customer/financial migration.
CREATE TABLE IF NOT EXISTS staff_posts (
 id TEXT PRIMARY KEY NOT NULL,
 staff_id TEXT NOT NULL REFERENCES staff_users(id),
 author_name TEXT NOT NULL,
 text TEXT NOT NULL CHECK(length(text)<=3000),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 client_request_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
 created_at TEXT NOT NULL,
 deleted_at TEXT,
 deleted_by TEXT REFERENCES staff_users(id),
 delete_reason TEXT NOT NULL DEFAULT '' CHECK(length(delete_reason)<=300),
 UNIQUE(staff_id,client_request_id)
);
CREATE TABLE IF NOT EXISTS staff_post_uploads (
 id TEXT PRIMARY KEY NOT NULL,
 staff_id TEXT NOT NULL REFERENCES staff_users(id),
 mime TEXT NOT NULL CHECK(mime IN('image/png','image/jpeg','image/webp','video/mp4')),
 declared_bytes INTEGER NOT NULL CHECK(declared_bytes BETWEEN 1 AND 20971520),
 received_bytes INTEGER NOT NULL DEFAULT 0 CHECK(received_bytes>=0 AND received_bytes<=declared_bytes),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','complete','cancelled','expired')),
 completed_media_id TEXT REFERENCES staff_post_media(id),
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 CHECK(mime='video/mp4' OR declared_bytes<=4194304)
);
CREATE TABLE IF NOT EXISTS staff_post_upload_chunks (
 upload_id TEXT NOT NULL REFERENCES staff_post_uploads(id),
 offset INTEGER NOT NULL CHECK(offset>=0),
 object_id TEXT NOT NULL UNIQUE,
 byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 1 AND 1048576),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 PRIMARY KEY(upload_id,offset)
);
CREATE TABLE IF NOT EXISTS staff_post_media (
 id TEXT PRIMARY KEY NOT NULL,
 staff_id TEXT NOT NULL REFERENCES staff_users(id),
 upload_id TEXT NOT NULL UNIQUE REFERENCES staff_post_uploads(id),
 post_id TEXT REFERENCES staff_posts(id),
 kind TEXT NOT NULL CHECK(kind IN('image','video')),
 mime TEXT NOT NULL CHECK(mime IN('image/png','image/jpeg','image/webp','video/mp4')),
 byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 1 AND 20971520),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 2048),
 height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 2048),
 duration_ms INTEGER CHECK(duration_ms IS NULL OR duration_ms BETWEEN 1 AND 60000),
 state TEXT NOT NULL DEFAULT 'ready' CHECK(state IN('ready','attached','deleted')),
 created_at TEXT NOT NULL,
 CHECK((kind='image' AND mime IN('image/png','image/jpeg','image/webp') AND byte_length<=4194304 AND duration_ms IS NULL) OR (kind='video' AND mime='video/mp4' AND duration_ms IS NOT NULL)),
 CHECK((state='ready' AND post_id IS NULL) OR (state IN('attached','deleted') AND post_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS staff_posts_visible ON staff_posts(staff_id,deleted_at,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS staff_post_uploads_pending ON staff_post_uploads(staff_id,state,expires_at);
CREATE INDEX IF NOT EXISTS staff_post_media_post ON staff_post_media(post_id,state);
