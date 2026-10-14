import { contentRepository } from './content-repository';
import { requireOwner, json, type OwnerEnv } from './owner';
import { visitor, HttpError } from './session';
import { publicProfile } from './profile';
import { readLimitedText, BodyTooLargeError } from './http';
import type { D1Database } from '@cloudflare/workers-types';
interface Comment {
  id: string;
  post_id: string;
  parent_id: string | null;
  nickname: string;
  body: string;
  status: string;
  revision: number;
  created_at: string;
}
async function reserve(
  db: D1Database,
  key: string,
  window: number,
  cap: number,
) {
  return !!(await db
    .prepare(
      'INSERT INTO comment_limits(bucket,window,count) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window WHERE window<>excluded.window OR count<? RETURNING count',
    )
    .bind(key, window, cap)
    .first());
}
export async function commentsRoute(
  request: Request,
  env: OwnerEnv,
): Promise<Response | undefined> {
  const url = new URL(request.url),
    reply = url.pathname === '/api/admin/comments/reply',
    admin = url.pathname === '/api/admin/comments' || reply;
  if (!admin && url.pathname !== '/api/comments') return;
  if (admin) {
    const denied = await requireOwner(request, env);
    if (denied) return denied;
  }
  if (!env.DB) return json({ error: '评论存储尚未配置。' }, 503);
  try {
    const repo = contentRepository(env.DB);
    if (request.method === 'GET') {
      if (reply) return json({ error: '请求方法不支持。' }, 405);
      const page = Number(url.searchParams.get('page') || 1);
      if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
        return json({ error: '页码无效。' }, 400);
      let rows;
      if (admin) {
        const state = url.searchParams.get('status') || 'pending';
        if (
          !['pending', 'approved', 'hidden', 'deleted', 'all'].includes(state)
        )
          return json({ error: '评论状态无效。' }, 400);
        rows = await env.DB.prepare(
          `SELECT id,post_id,parent_id,nickname,body,status,revision,created_at FROM comments ${state === 'all' ? '' : 'WHERE status=?'} ORDER BY created_at DESC,id LIMIT 21 OFFSET ?`,
        )
          .bind(...(state === 'all' ? [] : [state]), (page - 1) * 20)
          .all<Comment>();
      } else {
        const id = url.searchParams.get('postId') || '';
        if (!(await repo.getPublished(id)))
          return json({ error: '内容不存在或不可公开。' }, 404);
        rows = await env.DB.prepare(
          "SELECT c.id,c.post_id,c.parent_id,c.nickname,c.body,c.created_at,CASE WHEN c.actor_id='owner' THEN 1 ELSE 0 END AS owner FROM comments c LEFT JOIN comments parent ON parent.id=c.parent_id WHERE c.post_id=? AND c.status='approved' AND (c.parent_id IS NULL OR parent.status='approved') ORDER BY c.created_at,c.id LIMIT 21 OFFSET ?",
        )
          .bind(id, (page - 1) * 20)
          .all<Comment>();
      }
      return json({
        items: rows.results.slice(0, 20),
        hasMore: rows.results.length > 20,
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
      body = JSON.parse(await readLimitedText(request, 8192));
    } catch (error) {
      return json(
        { error: '评论内容无效或过大。' },
        error instanceof BodyTooLargeError ? 413 : 400,
      );
    }
    if (reply) {
      if (
        typeof body?.parentId !== 'string' ||
        typeof body.body !== 'string' ||
        !body.body.trim() ||
        [...body.body.trim()].length > 1000 ||
        typeof body.clientId !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(body.clientId)
      )
        return json({ error: '回复内容无效。' }, 400);
      const parent = await env.DB.prepare(
        "SELECT post_id FROM comments WHERE id=? AND status='approved' AND parent_id IS NULL",
      )
        .bind(body.parentId)
        .first<{ post_id: string }>();
      if (!parent || !(await repo.getPublished(parent.post_id)))
        return json(
          { error: '请先通过原评论，当前只支持回复已公开的一级评论。' },
          409,
        );
      const existing = await env.DB.prepare(
        'SELECT actor_id FROM comments WHERE id=?',
      )
        .bind(body.clientId)
        .first<{ actor_id: string }>();
      if (existing)
        return existing.actor_id === 'owner'
          ? json({ id: body.clientId, status: 'approved' })
          : json({ error: '回复 ID 冲突。' }, 409);
      const profile = await publicProfile(env);
      await env.DB.prepare(
        "INSERT INTO comments(id,post_id,parent_id,actor_id,nickname,body,status,created_at) VALUES(?,?,?,'owner',?,?,'approved',?)",
      )
        .bind(
          body.clientId,
          parent.post_id,
          body.parentId,
          profile.name,
          body.body.trim(),
          new Date().toISOString(),
        )
        .run();
      return json({ id: body.clientId, status: 'approved' });
    }
    if (admin) {
      if (
        typeof body?.id !== 'string' ||
        !['approved', 'hidden', 'deleted'].includes(body.status) ||
        !Number.isInteger(body.revision)
      )
        return json({ error: '审核参数无效。' }, 400);
      const old = await env.DB.prepare(
        'SELECT post_id FROM comments WHERE id=?',
      )
        .bind(body.id)
        .first<{ post_id: string }>();
      if (!old) return json({ error: '评论不存在。' }, 404);
      if (body.status === 'approved' && !(await repo.getPublished(old.post_id)))
        return json({ error: '不能公开已撤回文章的评论。' }, 409);
      const row = await env.DB.prepare(
        'UPDATE comments SET status=?,revision=revision+1 WHERE id=? AND revision=? RETURNING id,status,revision',
      )
        .bind(body.status, body.id, body.revision)
        .first();
      return row
        ? json(row)
        : json({ error: '评论已被更新，请重新载入。' }, 409);
    }
    if (
      typeof body?.postId !== 'string' ||
      typeof body.nickname !== 'string' ||
      !body.nickname.trim() ||
      [...body.nickname.trim()].length > 30 ||
      typeof body.body !== 'string' ||
      !body.body.trim() ||
      [...body.body.trim()].length > 1000 ||
      typeof body.clientId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(body.clientId) ||
      (body.parentId !== null &&
        body.parentId !== undefined &&
        typeof body.parentId !== 'string')
    )
      return json({ error: '请输入昵称（1–30字）与评论（1–1000字）。' }, 400);
    if (!(await repo.getPublished(body.postId)))
      return json({ error: '内容不存在或不可公开。' }, 404);
    const session = await visitor(request, env.DB, false);
    const duplicate = await env.DB.prepare(
      'SELECT actor_id,status FROM comments WHERE id=?',
    )
      .bind(body.clientId)
      .first<{ actor_id: string; status: string }>();
    if (duplicate)
      return duplicate.actor_id === session.id
        ? json({ id: body.clientId, status: duplicate.status })
        : json({ error: '评论 ID 冲突，请刷新后重试。' }, 409);
    if (body.parentId) {
      const parent = await env.DB.prepare(
        "SELECT id FROM comments WHERE id=? AND post_id=? AND status='approved' AND parent_id IS NULL",
      )
        .bind(body.parentId, body.postId)
        .first();
      if (!parent)
        return json(
          { error: '回复目标不存在或未公开；当前支持一级回复。' },
          404,
        );
    }
    const minute = Math.floor(Date.now() / 60000),
      ip = request.headers.get('CF-Connecting-IP') || 'local';
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('comment:' + ip),
    );
    const ipHash = Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    if (
      !(await reserve(env.DB, 'visitor:' + session.id, minute, 2)) ||
      !(await reserve(env.DB, 'ip:' + ipHash, Math.floor(minute / 60), 6)) ||
      !(await reserve(env.DB, 'global', Math.floor(minute / 1440), 100))
    )
      return json(
        { error: '评论提交过于频繁或今日额度已用完，请稍后重试。' },
        429,
      );
    await env.DB.prepare(
      'INSERT INTO comments(id,post_id,parent_id,actor_id,nickname,body,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',
    )
      .bind(
        body.clientId,
        body.postId,
        body.parentId || null,
        session.id,
        body.nickname.trim(),
        body.body.trim(),
        new Date().toISOString(),
      )
      .run();
    return json({ id: body.clientId, status: 'pending' });
  } catch (error) {
    if (error instanceof HttpError)
      return json({ error: error.message }, error.status);
    return json({ error: '评论服务暂不可用，请重试。' }, 503);
  }
}
