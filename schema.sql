CREATE TABLE IF NOT EXISTS shared_reviews (
  token TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  client_name TEXT,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS shared_reviews_owner_idx ON shared_reviews(owner_email);
CREATE INDEX IF NOT EXISTS shared_reviews_expires_idx ON shared_reviews(expires_at);
