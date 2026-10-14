import { requireOwner, json, type OwnerEnv } from './owner';
import { publicProfile } from './profile';
import { getSiteCopy } from './site-copy';
import { siteOrigin, type SiteConfig } from '../src/lib/site';
import type { Post } from '../src/lib/content';
export async function backupsRoute(
  request: Request,
  env: OwnerEnv & SiteConfig,
) {
  const path = new URL(request.url).pathname;
  if (!['/api/admin/backups', '/api/admin/backups/export'].includes(path))
    return;
  const denied = await requireOwner(request, env);
  if (denied) return denied;
  if (request.method !== 'GET') return json({ error: '请求方法不支持。' }, 405);
  if (!env.DB) return json({ error: '备份存储尚未配置。' }, 503);
  try {
    const counts = await env.DB.prepare(
      'SELECT COUNT(*) AS posts,SUM(length(CAST(document AS BLOB))) AS bytes FROM contents',
    ).first<{ posts: number; bytes: number }>();
    if (path === '/api/admin/backups')
      return json({ posts: counts?.posts || 0, maxFileBytes: 5 * 1024 * 1024 });
    if ((counts?.posts || 0) > 5000 || (counts?.bytes || 0) > 4 * 1024 * 1024)
      return json(
        { error: '内容超过单份写作备份的上限，请使用 D1 数据库导出。' },
        413,
      );
    const rows = await env.DB.prepare(
      'SELECT c.document,l.post_id AS locationId,l.label AS locationLabel FROM contents c LEFT JOIN post_locations l ON l.post_id=c.id ORDER BY c.id LIMIT 5001',
    ).all<{
      document: string;
      locationId: string | null;
      locationLabel: string | null;
    }>();
    if (rows.results.length > 5000)
      return json({ error: '内容过多，请使用 D1 数据库导出。' }, 413);
    const posts = rows.results.map((row) => {
      const post = JSON.parse(row.document) as Post;
      if (row.locationId)
        post.location = row.locationLabel
          ? {
              id: post.location?.id || 'manual-' + post.id,
              label: row.locationLabel,
            }
          : undefined;
      return post;
    });
    const [siteCopy, profile] = await Promise.all([
      getSiteCopy(env),
      publicProfile(env),
    ]);
    const createdAt = new Date().toISOString();
    const response = json({
      format: 'sfsafi-writing-archive',
      version: 1,
      createdAt,
      site: siteOrigin(env),
      posts,
      siteCopy: siteCopy.settings,
      profile,
    });
    if (
      new TextEncoder().encode(await response.clone().text()).byteLength >
      5 * 1024 * 1024
    )
      return json({ error: '备份文件超过 5 MiB，请使用 D1 数据库导出。' }, 413);
    response.headers.set(
      'Content-Disposition',
      `attachment; filename="sfsafi-writing-${createdAt.slice(0, 10)}.json"`,
    );
    return response;
  } catch {
    return json({ error: '备份读取失败，请稍后重试。' }, 503);
  }
}
