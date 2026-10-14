import type { D1Database } from '@cloudflare/workers-types';
const schemas = [
  `CREATE TABLE IF NOT EXISTS qq_group_requests(id TEXT PRIMARY KEY,group_id TEXT NOT NULL,actor_id TEXT NOT NULL,seen_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS qq_subscriptions(id TEXT PRIMARY KEY,kind TEXT NOT NULL,target TEXT NOT NULL,actor TEXT NOT NULL,tags TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS qq_native_inbox(id TEXT PRIMARY KEY,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',lease_until INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS qq_events(id TEXT PRIMARY KEY,payload TEXT NOT NULL,cursor TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT 'pending',received_at TEXT NOT NULL,lease_until INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS qq_deliveries(id TEXT PRIMARY KEY,event_id TEXT NOT NULL,subscription_id TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,last_error TEXT,message_id TEXT,sent_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS qq_limits(bucket TEXT PRIMARY KEY,window INTEGER NOT NULL,count INTEGER NOT NULL)`,
];
const pending = new WeakMap<D1Database, Promise<unknown>>();
export async function ensureBotSchema(db: D1Database) {
  let work = pending.get(db);
  if (!work) {
    work = db.batch(schemas.map((sql) => db.prepare(sql)));
    pending.set(db, work);
  }
  try {
    await work;
  } catch (error) {
    pending.delete(db);
    throw error;
  }
}
