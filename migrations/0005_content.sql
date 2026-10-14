CREATE TABLE IF NOT EXISTS contents (
 id TEXT PRIMARY KEY, document TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','published','archived')),
 visibility TEXT NOT NULL CHECK(visibility='public'), revision INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS publication_outbox (
 event_id TEXT PRIMARY KEY, post_id TEXT NOT NULL, revision INTEGER NOT NULL,
 payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER NOT NULL DEFAULT 0, last_error TEXT, delivered_at TEXT
);
