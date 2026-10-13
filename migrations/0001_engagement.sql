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
 INSERT INTO post_stats(post_id,likes,dislikes) VALUES(NEW.post_id,CASE WHEN NEW.value=1 THEN 1 ELSE 0 END,CASE WHEN NEW.value=-1 THEN 1 ELSE 0 END)
 ON CONFLICT(post_id) DO UPDATE SET likes=likes+CASE WHEN NEW.value=1 THEN 1 ELSE 0 END, dislikes=dislikes+CASE WHEN NEW.value=-1 THEN 1 ELSE 0 END;
END;
CREATE TRIGGER IF NOT EXISTS vote_changed AFTER UPDATE OF value ON votes BEGIN
 UPDATE post_stats SET likes=likes+(CASE WHEN NEW.value=1 THEN 1 ELSE 0 END)-(CASE WHEN OLD.value=1 THEN 1 ELSE 0 END),dislikes=dislikes+(CASE WHEN NEW.value=-1 THEN 1 ELSE 0 END)-(CASE WHEN OLD.value=-1 THEN 1 ELSE 0 END) WHERE post_id=NEW.post_id;
END;
CREATE TRIGGER IF NOT EXISTS vote_removed AFTER DELETE ON votes BEGIN
 UPDATE post_stats SET likes=likes-(CASE WHEN OLD.value=1 THEN 1 ELSE 0 END),dislikes=dislikes-(CASE WHEN OLD.value=-1 THEN 1 ELSE 0 END) WHERE post_id=OLD.post_id;
END;
