import type { D1Database } from '@cloudflare/workers-types';
import { initialMigrations } from './generated/schema';
const pending = new WeakMap<D1Database, Promise<void>>();
export async function ensureInitialSchema(db: D1Database) {
  let promise = pending.get(db);
  if (!promise) {
    promise = (async () => {
      await db
        .prepare(
          'CREATE TABLE IF NOT EXISTS space_schema(version TEXT PRIMARY KEY)',
        )
        .run();
      const result = await db
        .prepare('SELECT version FROM space_schema')
        .all<{ version: string }>();
      const applied = new Set(result.results.map((row) => row.version));
      for (const migration of initialMigrations) {
        if (applied.has(migration.name)) continue;
        await db.batch([
          ...migration.statements.map((sql) => db.prepare(sql)),
          db
            .prepare('INSERT OR IGNORE INTO space_schema(version) VALUES(?)')
            .bind(migration.name),
        ]);
      }
    })();
    pending.set(db, promise);
  }
  try {
    await promise;
  } catch (error) {
    pending.delete(db);
    throw error;
  }
}
