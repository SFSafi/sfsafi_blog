CREATE TABLE IF NOT EXISTS comment_email_contacts (
 comment_id TEXT PRIMARY KEY, email TEXT NOT NULL,
 confirmed_at INTEGER, revoked_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS comment_mail (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('verify','reply')),
 contact_id TEXT NOT NULL, reply_id TEXT,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed','uncertain','canceled')),
 attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, sent_at INTEGER, provider_id TEXT
);
