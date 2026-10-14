import { withLocations } from './content-repository';
import { type Post } from '../src/lib/content';
import { requireOwner, json, type OwnerEnv } from './owner';
import { readLimitedText, BodyTooLargeError } from './http';
import { markdown } from './render';
export async function postsRoute(
  request: Request,
  env: OwnerEnv,
): Promise<Response | undefined> {
  const url = new URL(request.url),
    root = url.pathname === '/api/admin/posts',
    match = url.pathname.match(
      /^\/api\/admin\/posts\/([a-z0-9-]+)(?:\/(publish|withdraw|archive|delete|restore))?$/,
    );
  const preview = url.pathname === '/api/admin/preview';
  if (!root && !match && !preview) return;
  const denied = await requireOwner(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: '内容存储尚未配置。' }, 503);
  try {
    if (request.method === 'GET') {
      if (preview) return json({ error: '请求方法不支持。' }, 405);
      if (match) {
        const row = await env.DB.prepare(
          'SELECT document FROM contents WHERE id=?',
        )
          .bind(match[1])
          .first<{ document: string }>();
        return row
          ? json((await withLocations(env.DB, [JSON.parse(row.document)]))[0])
          : json({ error: '内容不存在。' }, 404);
      }
      const page = Number(url.searchParams.get('page') || 1);
      const state = url.searchParams.get('status') || 'all';
      const query = (url.searchParams.get('query') || '').trim();
      if (
        !Number.isSafeInteger(page) ||
        page < 1 ||
        page > 100000 ||
        !['all', 'published', 'draft', 'archived', 'trash'].includes(state) ||
        query.length > 120
      )
        return json({ error: '筛选参数无效。' }, 400);
      const filters = [
        state === 'trash'
          ? "json_extract(document,'$.deletedAt') IS NOT NULL"
          : "json_extract(document,'$.deletedAt') IS NULL",
      ];
      const args: (string | number)[] = [];
      if (!['all', 'trash'].includes(state)) {
        filters.push('status=?');
        args.push(state);
      }
      if (query) {
        filters.push(
          "(json_extract(document,'$.title') LIKE ? ESCAPE '\\' OR json_extract(document,'$.body') LIKE ? ESCAPE '\\')",
        );
        const pattern = '%' + query.replace(/[\\%_]/g, '\\$&') + '%';
        args.push(pattern, pattern);
      }
      const rows = await env.DB.prepare(
        `SELECT document FROM contents WHERE ${filters.join(' AND ')} ORDER BY json_extract(document,'$.updatedAt') DESC,id LIMIT 21 OFFSET ?`,
      )
        .bind(...args, (page - 1) * 20)
        .all<{ document: string }>();
      return json({
        items: rows.results.slice(0, 20).map((row) => {
          const p = JSON.parse(row.document) as Post;
          return {
            id: p.id,
            title: p.title || p.body.slice(0, 32),
            status: p.status,
            revision: p.revision,
            updatedAt: p.updatedAt,
            canonicalPath: p.canonicalPath,
            kind: p.kind,
            deletedAt: p.deletedAt,
          };
        }),
        hasMore: rows.results.length > 20,
        counts: await env.DB.prepare(
          "SELECT COUNT(*) AS allCount,SUM(CASE WHEN status='published' AND json_extract(document,'$.deletedAt') IS NULL THEN 1 ELSE 0 END) AS published,SUM(CASE WHEN status='draft' AND json_extract(document,'$.deletedAt') IS NULL THEN 1 ELSE 0 END) AS draft,SUM(CASE WHEN status='archived' AND json_extract(document,'$.deletedAt') IS NULL THEN 1 ELSE 0 END) AS archived,SUM(CASE WHEN json_extract(document,'$.deletedAt') IS NOT NULL THEN 1 ELSE 0 END) AS trash FROM contents",
        ).first(),
      });
    }
    if (request.method !== 'POST')
      return json({ error: '请求方法不支持。' }, 405);
    if (request.headers.get('Origin') !== url.origin)
      return json({ error: '请求来源无效。' }, 403);
    if (!request.headers.get('Content-Type')?.startsWith('application/json'))
      return json({ error: '需要 JSON 请求。' }, 415);
    let body;
    try {
      body = JSON.parse(await readLimitedText(request, 65536));
    } catch (error) {
      return json(
        {
          error:
            error instanceof BodyTooLargeError ? '内容过大。' : 'JSON 无效。',
        },
        error instanceof BodyTooLargeError ? 413 : 400,
      );
    }
    if (preview) {
      if (typeof body?.body !== 'string' || body.body.length > 20000)
        return json({ error: '正文最多 20000 字。' }, 400);
      return json({ html: markdown(body.body) });
    }
    const id = match?.[1] || body?.id;
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,100}$/.test(id))
      return json({ error: '内容 ID 无效。' }, 400);
    const row = await env.DB.prepare('SELECT document FROM contents WHERE id=?')
      .bind(id)
      .first<{ document: string }>();
    const old: Post | undefined = row
      ? (await withLocations(env.DB, [JSON.parse(row.document)]))[0]
      : undefined;
    if (
      !Number.isInteger(body?.revision) ||
      body.revision !== (old?.revision || 0)
    )
      return json({ error: '内容已被另一页面更新，请重新载入后再保存。' }, 409);
    const now = new Date().toISOString();
    if (old?.deletedAt && match?.[2] !== 'restore')
      return json({ error: '内容在回收站，请先恢复再编辑或发布。' }, 409);
    if (match?.[2] === 'delete' && body.confirm !== true)
      return json({ error: '请确认删除，内容将移入回收站。' }, 400);
    if (match?.[2] === 'restore' && !old?.deletedAt)
      return json({ error: '内容不在回收站。' }, 409);
    let post: Post;
    if (match?.[2]) {
      if (!old) return json({ error: '内容不存在。' }, 404);
      if (match[2] === 'publish' && !old.body.trim())
        return json({ error: '请先保存正文。' }, 400);
      post = {
        ...old,
        status:
          match[2] === 'publish'
            ? 'published'
            : ['archive', 'delete'].includes(match[2])
              ? 'archived'
              : 'draft',
        updatedAt: now,
        revision: old.revision + 1,
        deletedAt: match[2] === 'delete' ? now : undefined,
        ...(match[2] === 'publish'
          ? { firstPublishedAt: old.firstPublishedAt || now }
          : {}),
      };
    } else {
      if (!old && !/^post-[a-f0-9-]{36}$/.test(id))
        return json({ error: '新内容 ID 无效。' }, 400);
      if (
        typeof body.title !== 'string' ||
        [...body.title.trim()].length > 120 ||
        typeof body.body !== 'string' ||
        [...body.body].length > 20000 ||
        !body.body.trim() ||
        !['note', 'article'].includes(body.kind) ||
        (body.kind === 'article' && !body.title.trim()) ||
        typeof body.excerpt !== 'string' ||
        [...body.excerpt].length > 300 ||
        !Array.isArray(body.tags) ||
        body.tags.length > 8 ||
        body.tags.some(
          (t: unknown) =>
            typeof t !== 'string' || !t.trim() || [...t].length > 30,
        ) ||
        typeof body.location !== 'string' ||
        [...body.location.trim()].length > 80 ||
        typeof body.pinned !== 'boolean'
      )
        return json(
          {
            error:
              '标题、正文、标签或地点格式无效；标题120字、正文20000字、摘要300字、最多8个标签、地点80字。',
          },
          400,
        );
      post = {
        id,
        title: body.title.trim(),
        body: body.body,
        bodyFormat: 'markdown',
        kind: body.kind,
        excerpt: body.excerpt,
        tags: [...new Set(body.tags.map((t: string) => t.trim()))] as string[],
        pinned: body.pinned,
        location: body.location.trim()
          ? { id: 'manual-' + id, label: body.location.trim() }
          : undefined,
        media: old?.media || [],
        status: old?.status || 'draft',
        visibility: 'public',
        createdAt: old?.createdAt || now,
        updatedAt: now,
        firstPublishedAt: old?.firstPublishedAt,
        revision: (old?.revision || 0) + 1,
        canonicalPath: `/posts/${id}/`,
        sample: Boolean(
          old?.sample &&
          old.body === body.body &&
          (old.title || '') === body.title.trim(),
        ),
      };
    }
    const document = JSON.stringify(post);
    const mutation = old
      ? env.DB.prepare(
          'UPDATE contents SET document=?,status=?,revision=? WHERE id=? AND revision=? RETURNING document',
        ).bind(document, post.status, post.revision, id, old.revision)
      : env.DB.prepare(
          'INSERT INTO contents(id,document,status,visibility,revision) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING document',
        ).bind(id, document, post.status, 'public', post.revision);
    const work = [mutation];
    if (match?.[2] === 'delete') {
      // Keep historical comments/statistics; remove email subscriptions only after this revision wins.
      work.push(
        env.DB.prepare(
          "UPDATE comment_email_contacts SET email='',revoked_at=? WHERE comment_id IN (SELECT id FROM comments WHERE post_id=?) AND EXISTS(SELECT 1 FROM contents WHERE id=? AND revision=? AND status='archived')",
        ).bind(Math.floor(Date.now() / 1000), id, id, post.revision),
      );
      work.push(
        env.DB.prepare(
          "UPDATE comment_mail SET status='canceled' WHERE status='queued' AND contact_id IN (SELECT id FROM comments WHERE post_id=?) AND EXISTS(SELECT 1 FROM contents WHERE id=? AND revision=? AND status='archived')",
        ).bind(id, id, post.revision),
      );
    }
    if (!match?.[2])
      work.push(
        env.DB.prepare(
          'INSERT INTO post_locations(post_id,label,updated_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM contents WHERE id=? AND revision=?) ON CONFLICT(post_id) DO UPDATE SET label=excluded.label,updated_at=excluded.updated_at',
        ).bind(id, post.location?.label || null, now, id, post.revision),
      );
    if (post.status === 'published' && !old?.firstPublishedAt) {
      const event = {
        eventId: `first-published:${id}`,
        postId: id,
        revision: post.revision,
        eventType: 'first_published',
        occurredAt: now,
        title: post.title || post.body.slice(0, 60),
        excerpt: post.excerpt || post.body.slice(0, 200),
        tags: post.tags,
        canonicalPath: post.canonicalPath,
      };
      work.push(
        env.DB.prepare(
          'INSERT INTO publication_outbox(event_id,post_id,revision,payload) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM contents WHERE id=? AND revision=? AND status=?) ON CONFLICT DO NOTHING',
        ).bind(
          event.eventId,
          id,
          post.revision,
          JSON.stringify(event),
          id,
          post.revision,
          'published',
        ),
      );
    }
    const results = await env.DB.batch(work);
    if (!results[0].results.length)
      return json({ error: '内容已更新，请重新载入。' }, 409);
    return json(post);
  } catch {
    return json({ error: '内容保存或读取失败，请重试。' }, 503);
  }
}
