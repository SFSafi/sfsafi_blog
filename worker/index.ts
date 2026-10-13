import { searchRoute, type SearchEnv } from './search';
import { ensureInitialSchema } from './schema';
import { readLimitedText, BodyTooLargeError } from './http';
import type { D1Database } from '@cloudflare/workers-types';
import { locationRoute } from './locations';
import { profileRoute, type ProfileEnv } from './profile';
import { repository } from '../src/lib/content';
interface Env extends ProfileEnv, SearchEnv {
  DB?: D1Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
}
interface Stats {
  postId: string;
  views: number;
  likes: number;
  dislikes: number;
  myVote: number;
}
const cookieName = 'space_visitor';
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function json(data: unknown, status = 200, cookie?: string) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(JSON.stringify(data), { status, headers });
}
async function hash(value: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
async function visitor(request: Request, db: D1Database, create: boolean) {
  const token = (request.headers.get('Cookie') || '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(cookieName + '='))
    ?.slice(cookieName.length + 1);
  const now = Math.floor(Date.now() / 1000);
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const id = await hash(token);
    if (
      await db
        .prepare('SELECT id FROM visitors WHERE id=? AND expires_at>?')
        .bind(id, now)
        .first()
    )
      return { id };
  }
  if (!create) throw new HttpError(403, '请刷新页面后重试。');
  const next = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const id = await hash(next);
  await db
    .prepare('INSERT INTO visitors(id,expires_at) VALUES(?,?)')
    .bind(id, now + 90 * 86400)
    .run();
  const local = ['localhost', '127.0.0.1'].includes(
    new URL(request.url).hostname,
  );
  return {
    id,
    cookie: `${cookieName}=${next}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7776000${local ? '' : '; Secure'}`,
  };
}
async function limit(db: D1Database, id: string) {
  const result = await db
    .prepare(
      'INSERT INTO rate_limits(visitor_id,window,count) VALUES(?,?,1) ON CONFLICT(visitor_id) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window WHERE window<>excluded.window OR count<60 RETURNING count',
    )
    .bind(id, Math.floor(Date.now() / 60000))
    .first();
  if (!result) throw new HttpError(429, '操作太频繁。');
}
async function stats(
  db: D1Database,
  id: string,
  visitorId: string,
): Promise<Stats> {
  const row = await db
    .prepare(
      'SELECT s.views,s.likes,s.dislikes,COALESCE(v.value,0) AS myVote FROM post_stats s LEFT JOIN votes v ON v.post_id=s.post_id AND v.visitor_id=? WHERE s.post_id=?',
    )
    .bind(visitorId, id)
    .first<{
      views: number;
      likes: number;
      dislikes: number;
      myVote: number;
    }>();
  return {
    postId: id,
    views: row?.views ?? 0,
    likes: row?.likes ?? 0,
    dislikes: row?.dislikes ?? 0,
    myVote: row?.myVote ?? 0,
  };
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (env.DB) {
      try {
        await ensureInitialSchema(env.DB);
      } catch (error) {
        console.error(
          'Initial schema failed',
          error instanceof Error ? error.message : 'unknown',
        );
        return json({ error: '数据库初始化暂不可用，请稍后重试。' }, 503);
      }
    }
    const searchResponse = await searchRoute(request, env);
    if (searchResponse) return searchResponse;
    const locationResponse = await locationRoute(request, env);
    if (locationResponse) return locationResponse;
    const profileResponse = await profileRoute(request, env);
    if (profileResponse) return profileResponse;
    let session: { id: string; cookie?: string } | undefined;
    try {
      const list = url.pathname === '/api/engagement';
      const match = url.pathname.match(
        /^\/api\/engagement\/([a-z0-9-]+)\/(view|vote)$/,
      );
      if (!list && !match) throw new HttpError(404, '接口不存在。');
      if (
        (list && request.method !== 'GET') ||
        (match && request.method !== 'POST')
      )
        throw new HttpError(405, '请求方法不支持。');
      const ids = list
        ? (url.searchParams.get('ids') || '').split(',')
        : [match![1]];
      if (
        ids.length > 20 ||
        !ids.length ||
        ids.some((id) => !id || id.length > 100)
      )
        throw new HttpError(400, '内容参数无效。');
      for (const id of ids)
        if (!(await repository.getPublished(id)))
          throw new HttpError(404, '内容不存在或不可公开。');
      if (!env.DB) throw new HttpError(503, '统计服务未配置。');
      if (match) {
        if (request.headers.get('Origin') !== url.origin)
          throw new HttpError(403, '请求来源无效。');
        if (
          !request.headers.get('Content-Type')?.startsWith('application/json')
        )
          throw new HttpError(415, '需要 JSON 请求。');
      }
      session = await visitor(request, env.DB, list);
      await limit(env.DB, session.id);
      if (list)
        return json(
          await Promise.all(ids.map((id) => stats(env.DB!, id, session!.id))),
          200,
          session.cookie,
        );
      const text = await readLimitedText(request);
      if (new TextEncoder().encode(text).byteLength > 1024)
        throw new HttpError(413, '请求内容过大。');
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(text);
      } catch {
        throw new HttpError(400, 'JSON 无效。');
      }
      if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new HttpError(400, '请求内容无效。');
      const id = match![1];
      if (match![2] === 'view') {
        const day = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date());
        await env.DB.prepare(
          'INSERT INTO views(post_id,visitor_id,day) VALUES(?,?,?) ON CONFLICT DO NOTHING',
        )
          .bind(id, session.id, day)
          .run();
      } else {
        if (
          ![-1, 0, 1].includes(body.vote as number) ||
          typeof body.vote !== 'number'
        )
          throw new HttpError(400, '评价无效。');
        if (body.vote === 0)
          await env.DB.prepare(
            'DELETE FROM votes WHERE post_id=? AND visitor_id=?',
          )
            .bind(id, session.id)
            .run();
        else
          await env.DB.prepare(
            'INSERT INTO votes(post_id,visitor_id,value) VALUES(?,?,?) ON CONFLICT(post_id,visitor_id) DO UPDATE SET value=excluded.value',
          )
            .bind(id, session.id, body.vote)
            .run();
      }
      return json(await stats(env.DB, id, session.id), 200, session.cookie);
    } catch (error) {
      if (error instanceof BodyTooLargeError)
        return json({ error: '请求内容过大。' }, 413, session?.cookie);
      if (error instanceof HttpError)
        return json({ error: error.message }, error.status, session?.cookie);
      console.error(
        'engagement request failed',
        error instanceof Error ? error.message : 'unknown',
      );
      return json({ error: '统计服务暂不可用。' }, 503, session?.cookie);
    }
  },
};
