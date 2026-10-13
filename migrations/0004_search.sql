-- Additive public AI-search budget; no queries or raw IP addresses stored.
CREATE TABLE IF NOT EXISTS search_usage(bucket TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL);
