-- Optional initial schema reference; Worker auto-initializes these additive tables.
-- Visitor tokens are randomly issued by the server; only their SHA-256 hashes are stored.
CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS post_stats (post_id TEXT PRIMARY KEY, views INTEGER NOT NULL DEFAULT 0 CHECK(views>=0), likes INTEGER NOT NULL DEFAULT 0 CHECK(likes>=0), dislikes INTEGER NOT NULL DEFAULT 0 CHECK(dislikes>=0));
CREATE TABLE IF NOT EXISTS views (post_id TEXT NOT NULL, visitor_id TEXT NOT NULL REFERENCES visitors(id), day TEXT NOT NULL, PRIMARY KEY(post_id,visitor_id,day));
CREATE TABLE IF NOT EXISTS votes (post_id TEXT NOT NULL, visitor_id TEXT NOT NULL REFERENCES visitors(id), value INTEGER NOT NULL CHECK(value IN(-1,1)), PRIMARY KEY(post_id,visitor_id));
CREATE TABLE IF NOT EXISTS rate_limits (visitor_id TEXT PRIMARY KEY REFERENCES visitors(id), window INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS view_added AFTER INSERT ON views BEGIN
 INSERT INTO post_stats(post_id,views) VALUES(NEW.post_id,1) ON CONFLICT(post_id) DO UPDATE SET views=views+1;
END;
CREATE TRIGGER IF NOT EXISTS vote_added AFTER INSERT ON votes BEGIN
 INSERT INTO post_stats(post_id,likes,dislikes) VALUES(NEW.post_id,(NEW.value=1),(NEW.value=-1))
 ON CONFLICT(post_id) DO UPDATE SET likes=likes+(NEW.value=1), dislikes=dislikes+(NEW.value=-1);
END;
CREATE TRIGGER IF NOT EXISTS vote_changed AFTER UPDATE OF value ON votes BEGIN
 UPDATE post_stats SET likes=likes+((NEW.value=1))-((OLD.value=1)),dislikes=dislikes+((NEW.value=-1))-((OLD.value=-1)) WHERE post_id=NEW.post_id;
END;
CREATE TRIGGER IF NOT EXISTS vote_removed AFTER DELETE ON votes BEGIN
 UPDATE post_stats SET likes=likes-((OLD.value=1)),dislikes=dislikes-((OLD.value=-1)) WHERE post_id=OLD.post_id;
END;

CREATE TABLE IF NOT EXISTS avatars (id TEXT PRIMARY KEY, mime_type TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, bytes BLOB NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profile (id INTEGER PRIMARY KEY CHECK(id=1), nickname TEXT NOT NULL, bio TEXT NOT NULL, location TEXT NOT NULL, avatar_id TEXT REFERENCES avatars(id), updated_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS post_locations (post_id TEXT PRIMARY KEY, label TEXT, updated_at TEXT NOT NULL);


-- Additive public AI-search budget; no queries or raw IP addresses stored.
CREATE TABLE IF NOT EXISTS search_usage(bucket TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL);
