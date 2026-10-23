-- Optional staff profile fields only; financial achievements remain in sales_publications.
CREATE TABLE IF NOT EXISTS staff_profile_avatars (
 id TEXT PRIMARY KEY NOT NULL,
 staff_id TEXT NOT NULL REFERENCES staff_users(id),
 mime TEXT NOT NULL CHECK(mime IN('image/png','image/jpeg','image/webp')),
 byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 1 AND 2097152),
 width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 2048),
 height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 2048),
 sha256 TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES staff_users(id),
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_profiles (
 staff_id TEXT PRIMARY KEY NOT NULL REFERENCES staff_users(id),
 age INTEGER CHECK(age IS NULL OR age BETWEEN 1 AND 120),
 bio TEXT NOT NULL DEFAULT '' CHECK(length(bio)<=600),
 avatar_id TEXT REFERENCES staff_profile_avatars(id),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),
 updated_by TEXT NOT NULL REFERENCES staff_users(id),
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS staff_profile_avatars_owner ON staff_profile_avatars(staff_id,created_at);
