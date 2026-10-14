import { readLimitedText, BodyTooLargeError } from './http';
import { type Post } from '../src/lib/content';
import { contentRepository } from './content-repository';
import { requireAdmin, type ProfileEnv } from './profile';
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
async function publicPosts(env: ProfileEnv) {
  const repository = contentRepository(env.DB);
  const posts: Post[] = [];
  let page = 1;
  while (true) {
    const result = await repository.listPublished({ page, pageSize: 100 });
    posts.push(...result.items);
    if (!result.hasMore) break;
    page++;
  }
  return posts;
}
async function locations(env: ProfileEnv) {
  const result = await env
    .DB!.prepare('SELECT post_id,label FROM post_locations')
    .all<{ post_id: string; label: string | null }>();
  const overrides = new Map(
    result.results.map((row) => [row.post_id, row.label]),
  );
  return (await publicPosts(env)).map((post) => ({
    postId: post.id,
    title: post.title || post.body.slice(0, 32),
    path: post.canonicalPath,
    label: overrides.has(post.id)
      ? overrides.get(post.id)!
      : (post.location?.label ?? null),
  }));
}
export async function locationRoute(
  request: Request,
  env: ProfileEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const admin = url.pathname === '/api/admin/locations';
  if (!admin && url.pathname !== '/api/post-locations') return null;
  if (admin) {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
  }
  if (!env.DB) return json({ error: '地点存储尚未配置。' }, 503);
  try {
    if (request.method === 'GET') {
      const list = await locations(env);
      if (admin) return json(list);
      const ids = url.searchParams.get('ids');
      return json(
        ids
          ? list.filter((post) => ids.split(',').includes(post.postId))
          : list,
      );
    }
    if (!admin || request.method !== 'POST')
      return json({ error: '请求方法不支持。' }, 405);
    if (request.headers.get('Origin') !== url.origin)
      return json({ error: '请求来源无效。' }, 403);
    if (!request.headers.get('Content-Type')?.startsWith('application/json'))
      return json({ error: '需要 JSON 请求。' }, 415);
    const text = await readLimitedText(request);
    if (text.length > 1024) return json({ error: '内容过长。' }, 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: 'JSON 无效。' }, 400);
    }
    if (
      !body ||
      typeof body.postId !== 'string' ||
      typeof body.label !== 'string' ||
      [...body.label.trim()].length > 80
    )
      return json({ error: '地点最多 80 字。' }, 400);
    if (!(await contentRepository(env.DB).getPublished(body.postId)))
      return json({ error: '内容不存在或不可公开。' }, 404);
    await env.DB.prepare(
      'INSERT INTO post_locations(post_id,label,updated_at) VALUES(?,?,?) ON CONFLICT(post_id) DO UPDATE SET label=excluded.label,updated_at=excluded.updated_at',
    )
      .bind(body.postId, body.label.trim() || null, new Date().toISOString())
      .run();
    return json({ postId: body.postId, label: body.label.trim() || null });
  } catch (error) {
    if (error instanceof BodyTooLargeError)
      return json({ error: '请求内容过大。' }, 413);
    return json({ error: '地点保存或读取失败，请重试。' }, 503);
  }
}
