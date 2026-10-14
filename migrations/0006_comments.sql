CREATE TABLE IF NOT EXISTS comments (
 id TEXT PRIMARY KEY, post_id TEXT NOT NULL, parent_id TEXT,
 actor_id TEXT NOT NULL, nickname TEXT NOT NULL, body TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','hidden','deleted')),
 revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comment_limits (
 bucket TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL
);
