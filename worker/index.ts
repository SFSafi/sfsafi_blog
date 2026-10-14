import { applySiteCopy, siteCopyRoute } from './site-copy';
import {
  commentEmailRoute,
  deliverCommentMail,
  type CommentMailEnv,
} from './comment-mail';
import { qqAdminRoute } from './qq-admin';
import { mediaRoute, type MediaEnv } from './media';
import {
  notificationRoute,
  deliverUpdates,
  type NotificationEnv,
} from './notifications';
import { HttpError, json, visitor, limit } from './session';
import { commentsRoute } from './comments';
import { searchRoute, type SearchEnv } from './search';
import { ensureInitialSchema } from './schema';
import { readLimitedText, BodyTooLargeError } from './http';
import type { D1Database } from '@cloudflare/workers-types';
import { locationRoute } from './locations';
import { profileRoute, type ProfileEnv } from './profile';
import { contentRepository, ensureContentSeed } from './content-repository';
import { postsRoute } from './posts';
import { pageRoute } from './render';
import type { OwnerEnv } from './owner';
interface Env
  extends
    ProfileEnv,
    SearchEnv,
    OwnerEnv,
    NotificationEnv,
    MediaEnv,
    CommentMailEnv {
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
  scheduled(
    _event: unknown,
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ) {
    ctx.waitUntil(deliverUpdates(env));
    ctx.waitUntil(deliverCommentMail(env));
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      const decoded = decodeURIComponent(url.pathname);
      if (decoded !== url.pathname) {
        url.pathname = decoded;
        request = new Request(url, request);
      }
    } catch {
      return new Response('Not found', { status: 404 });
    }
    if (url.pathname === '/index.html')
      return Response.redirect(url.origin + '/' + url.search, 308);
    if (
      url.pathname.endsWith('/index.html') &&
      /^\/(posts|page|articles|tags|locations|admin|about|search)\//.test(
        url.pathname,
      )
    )
      return Response.redirect(
        url.origin + url.pathname.slice(0, -10) + url.search,
        308,
      );
    const dynamic =
      /^\/(?:$|posts(?:\/|$)|page(?:\/|$)|articles(?:\/|$)|tags(?:\/|$)|locations(?:\/|$))/.test(
        url.pathname,
      );
    const htmlAsset =
      /^\/(admin(?:\/|$)|about(?:\/|$)|search(?:\/|$)|404\.html$)/.test(
        url.pathname,
      );
    if (!url.pathname.startsWith('/api/') && !dynamic && !htmlAsset) {
      if (
        /^\/(?:_astro\/|media\/|licenses\/|admin\/|about\/|search\/|favicon\.svg$|404\.html$)/.test(
          url.pathname,
        )
      )
        return env.ASSETS.fetch(request);
      return new Response('Not found', { status: 404 });
    }
    const mediaResponse = await mediaRoute(request, env);
    if (mediaResponse) return mediaResponse;
    if (env.DB) {
      try {
        await ensureInitialSchema(env.DB);
        await ensureContentSeed(env.DB);
      } catch (error) {
        console.error(
          'Initial schema failed',
          error instanceof Error ? error.message : 'unknown',
        );
        return json({ error: '数据库初始化暂不可用，请稍后重试。' }, 503);
      }
    }
    if (htmlAsset) {
      const headers = new Headers(request.headers);
      headers.set('Accept-Encoding', 'identity');
      headers.delete('If-None-Match');
      headers.delete('If-Modified-Since');
      return applySiteCopy(
        request,
        env,
        await env.ASSETS.fetch(
          new Request(request.url, { method: request.method, headers }),
        ),
      );
    }
    if (!url.pathname.startsWith('/api/')) {
      if (!url.pathname.endsWith('/'))
        return Response.redirect(
          url.origin + url.pathname + '/' + url.search,
          308,
        );
      try {
        return await applySiteCopy(
          request,
          env,
          (await pageRoute(request, env)) ||
            new Response('Not found', { status: 404 }),
        );
      } catch {
        return new Response('页面暂不可用，请稍后重试。', {
          status: 503,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        });
      }
    }
    const copyResponse = await siteCopyRoute(request, env);
    if (copyResponse) return copyResponse;
    const emailResponse = await commentEmailRoute(request, env);
    if (emailResponse) return emailResponse;
    const qqResponse = await qqAdminRoute(request, env);
    if (qqResponse) return qqResponse;
    const notificationResponse = await notificationRoute(request, env);
    if (notificationResponse) return notificationResponse;
    const commentsResponse = await commentsRoute(request, env);
    if (commentsResponse) return commentsResponse;
    const postsResponse = await postsRoute(request, env);
    if (postsResponse) return postsResponse;
    const repository = contentRepository(env.DB);
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
