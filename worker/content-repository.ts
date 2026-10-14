import type { D1Database } from '@cloudflare/workers-types';
import {
  repository as samples,
  type ContentRepository,
  type Post,
} from '../src/lib/content';
const seeded = new WeakMap<D1Database, Promise<void>>();
export async function ensureContentSeed(db: D1Database) {
  let work = seeded.get(db);
  if (!work) {
    work = (async () => {
      const result = await samples.listPublished({ page: 1, pageSize: 100 });
      await db.batch(
        result.items.map((post) =>
          db
            .prepare(
              'INSERT OR IGNORE INTO contents(id,document,status,visibility,revision) VALUES(?,?,?,?,?)',
            )
            .bind(
              post.id,
              JSON.stringify({ ...post, sample: true }),
              post.status,
              post.visibility,
              post.revision,
            ),
        ),
      );
    })();
    seeded.set(db, work);
  }
  try {
    await work;
  } catch (error) {
    seeded.delete(db);
    throw error;
  }
}
export async function withLocations(db: D1Database, posts: Post[]) {
  if (!posts.length) return posts;
  const rows = await db
    .prepare(
      `SELECT post_id,label FROM post_locations WHERE post_id IN (${posts.map(() => '?').join(',')})`,
    )
    .bind(...posts.map((p) => p.id))
    .all<{ post_id: string; label: string | null }>();
  const overrides = new Map(rows.results.map((r) => [r.post_id, r.label]));
  return posts.map((post) =>
    !overrides.has(post.id)
      ? post
      : {
          ...post,
          location: overrides.get(post.id)
            ? {
                id: post.location?.id || 'manual-' + post.id,
                label: overrides.get(post.id)!,
              }
            : undefined,
        },
  );
}
export function contentRepository(db?: D1Database): ContentRepository {
  if (!db) return samples;
  return {
    async listPublishedLinks(page, pageSize) {
      const rows = await db
        .prepare(
          "SELECT json_extract(document,'$.canonicalPath') AS path,json_extract(document,'$.updatedAt') AS updatedAt FROM contents WHERE status='published' AND visibility='public' ORDER BY id LIMIT ? OFFSET ?",
        )
        .bind(pageSize + 1, (page - 1) * pageSize)
        .all<{ path: string; updatedAt: string }>();
      return {
        items: rows.results.slice(0, pageSize),
        hasMore: rows.results.length > pageSize,
      };
    },
    async getRelatedPublished(post, limit) {
      const rows = await db
        .prepare(
          "SELECT document FROM contents c WHERE status='published' AND visibility='public' AND id<>? ORDER BY (SELECT COUNT(*) FROM json_each(c.document,'$.tags') t WHERE t.value IN (SELECT value FROM json_each(?))) DESC,json_extract(document,'$.firstPublishedAt') DESC,id LIMIT ?",
        )
        .bind(
          post.id,
          JSON.stringify(post.tags),
          Math.max(0, Math.min(3, limit)),
        )
        .all<{ document: string }>();
      return rows.results.map((row) => JSON.parse(row.document) as Post);
    },
    async listPublished({ page, pageSize, kind, tag, location, media, order }) {
      const conditions = ["status='published'", "visibility='public'"];
      const args: (string | number)[] = [];
      if (media) conditions.push("json_array_length(document,'$.media')>0");
      if (kind) {
        conditions.push("json_extract(document,'$.kind')=?");
        args.push(kind);
      }
      if (tag) {
        conditions.push(
          "EXISTS (SELECT 1 FROM json_each(document,'$.tags') WHERE value=?)",
        );
        args.push(tag);
      }
      if (location) {
        conditions.push(
          "COALESCE(json_extract(document,'$.location.id'),'manual-'||id)=?",
        );
        args.push(location);
      }
      const result = await db
        .prepare(
          `SELECT document FROM contents WHERE ${conditions.join(' AND ')} ORDER BY ${order === 'newest' ? '' : "json_extract(document,'$.pinned') DESC,"} json_extract(document,'$.firstPublishedAt') DESC, id LIMIT ? OFFSET ?`,
        )
        .bind(...args, pageSize + 1, (page - 1) * pageSize)
        .all<{ document: string }>();
      return {
        items: await withLocations(
          db,
          result.results
            .slice(0, pageSize)
            .map((row) => JSON.parse(row.document) as Post),
        ),
        hasMore: result.results.length > pageSize,
      };
    },
    async getPublished(id) {
      const row = await db
        .prepare(
          "SELECT document FROM contents WHERE id=? AND status='published' AND visibility='public'",
        )
        .bind(id)
        .first<{ document: string }>();
      return row
        ? (await withLocations(db, [JSON.parse(row.document) as Post]))[0]
        : undefined;
    },
    async getTags() {
      const rows = await db
        .prepare(
          "SELECT DISTINCT j.value AS tag FROM contents c,json_each(c.document,'$.tags') j WHERE c.status='published' AND c.visibility='public' ORDER BY tag",
        )
        .all<{ tag: string }>();
      return rows.results.map((row) => row.tag);
    },
    async getLocations() {
      const rows = await db
        .prepare(
          "SELECT c.id AS postId,json_extract(c.document,'$.location.id') AS id,CASE WHEN l.post_id IS NOT NULL THEN l.label ELSE json_extract(c.document,'$.location.label') END AS label FROM contents c LEFT JOIN post_locations l ON l.post_id=c.id WHERE c.status='published' AND c.visibility='public'",
        )
        .all<{ postId: string; id: string | null; label: string | null }>();
      return [
        ...new Map(
          rows.results
            .filter((r) => r.label)
            .map((r) => [
              r.id || 'manual-' + r.postId,
              { id: r.id || 'manual-' + r.postId, label: r.label! },
            ]),
        ).values(),
      ];
    },
    getProfile: samples.getProfile,
    mediaUrl: samples.mediaUrl,
  };
}
