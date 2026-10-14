import { SignJWT, jwtVerify } from 'jose';
import type {
  D1Database,
  D1PreparedStatement,
} from '@cloudflare/workers-types';
import type { OwnerEnv } from './owner';
import { contentRepository } from './content-repository';
import { ensureInitialSchema } from './schema';
import { json } from './owner';

export interface CommentMailEnv extends OwnerEnv {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_TOKEN_SECRET?: string;
  SITE_URL?: string;
  MAIL_DAILY_LIMIT?: string;
}
export function mailConfigured(env: CommentMailEnv) {
  try {
    const site = new URL(env.SITE_URL || '');
    const from = env.EMAIL_FROM?.match(/<([^<>]+)>$/)?.[1] || env.EMAIL_FROM;
    if (!normalizeEmail(from)) return false;
    const cap = Number(env.MAIL_DAILY_LIMIT ?? 100);
    if (!Number.isSafeInteger(cap) || cap < 1 || cap > 1000) return false;
    return !!(
      env.RESEND_API_KEY &&
      env.EMAIL_FROM &&
      !/[\r\n]/.test(env.EMAIL_FROM) &&
      env.EMAIL_TOKEN_SECRET &&
      env.EMAIL_TOKEN_SECRET.length >= 32 &&
      site.protocol === 'https:' &&
      site.pathname === '/' &&
      !site.username &&
      !site.password &&
      !site.search &&
      !site.hash
    );
  } catch {
    return false;
  }
}
export function normalizeEmail(input: unknown) {
  if (input === undefined || input === '') return '';
  if (typeof input !== 'string') throw Error('邮箱格式无效。');
  const email = input.trim().toLowerCase();
  if (!email) return '';
  if (
    email.length > 254 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(
      email,
    ) ||
    email.split('@')[0].length > 64
  )
    throw Error('请填写有效邮箱，或留空。');
  return email;
}
export function replyMailStatement(
  db: D1Database,
  replyId: string,
  parentId: string,
  actor: string,
  now: number,
): D1PreparedStatement {
  return db
    .prepare(
      "INSERT OR IGNORE INTO comment_mail(id,kind,contact_id,reply_id,created_at) SELECT ?,'reply',e.comment_id,?,? FROM comment_email_contacts e JOIN comments c ON c.id=e.comment_id WHERE e.comment_id=? AND e.email<>'' AND e.revoked_at IS NULL AND c.actor_id<>? AND EXISTS(SELECT 1 FROM comments r WHERE r.id=? AND r.actor_id=? AND r.parent_id=e.comment_id AND r.post_id=c.post_id)",
    )
    .bind('reply:' + replyId, replyId, now, parentId, actor, replyId, actor);
}
async function token(
  env: CommentMailEnv,
  id: string,
  scope: string,
  issued: number,
) {
  return new SignJWT({ scope })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('comment-email')
    .setAudience('comment-email')
    .setSubject(id)
    .setIssuedAt(issued)
    .setExpirationTime(issued + (scope === 'verify' ? 86400 : 365 * 86400))
    .sign(new TextEncoder().encode(env.EMAIL_TOKEN_SECRET!));
}

export async function commentEmailRoute(request: Request, env: CommentMailEnv) {
  const url = new URL(request.url);
  const match = url.pathname.match(
    /^\/api\/comment-email\/(verify|unsubscribe)$/,
  );
  if (!match) return null;
  if (!env.DB || !env.EMAIL_TOKEN_SECRET || env.EMAIL_TOKEN_SECRET.length < 32)
    return json({ error: '邮箱通知尚未配置。' }, 503);
  if (!['GET', 'POST'].includes(request.method))
    return json({ error: '请求方法不支持。' }, 405);
  let id: string;
  const value = url.searchParams.get('token') || '';
  try {
    if (value.length > 2048 || !/^[A-Za-z0-9_.-]+$/.test(value)) throw Error();
    const { payload } = await jwtVerify(
      value,
      new TextEncoder().encode(env.EMAIL_TOKEN_SECRET),
      {
        algorithms: ['HS256'],
        issuer: 'comment-email',
        audience: 'comment-email',
        requiredClaims: ['exp', 'iat', 'sub'],
      },
    );
    if (
      payload.scope !== match[1] ||
      !payload.sub ||
      !/^[a-f0-9-]{36}$/.test(payload.sub)
    )
      throw Error();
    id = payload.sub;
  } catch {
    return json({ error: '邮件链接无效或已过期。' }, 400);
  }
  const contact = await env.DB.prepare(
    'SELECT revoked_at,email FROM comment_email_contacts WHERE comment_id=?',
  )
    .bind(id)
    .first<{ revoked_at: number | null; email: string }>();
  if (!contact || contact.revoked_at !== null || !contact.email)
    return json({ error: '已退订或订阅不存在。' }, 410);
  const action =
    match[1] === 'verify'
      ? '确认接收这条评论的回复邮件'
      : '停止接收这条评论的回复邮件';
  if (request.method === 'GET') {
    // Mail link scanners must not confirm or unsubscribe recipients by opening a URL.
    return new Response(
      `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>评论邮件通知</title><body><h1>评论邮件通知</h1><p>评论本身已公开。邮箱仅用于通知，不会公开展示。</p><form method="post"><button type="submit">${action}</button></form></body></html>`,
      {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy':
            "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        },
      },
    );
  }
  if (request.headers.get('Origin') !== url.origin)
    return json({ error: '请求来源无效。' }, 403);
  const now = Math.floor(Date.now() / 1000);
  if (match[1] === 'verify')
    await env.DB.prepare(
      'UPDATE comment_email_contacts SET confirmed_at=COALESCE(confirmed_at,?) WHERE comment_id=? AND revoked_at IS NULL',
    )
      .bind(now, id)
      .run();
  else
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE comment_email_contacts SET email='',revoked_at=? WHERE comment_id=?",
      ).bind(now, id),
      env.DB.prepare(
        "UPDATE comment_mail SET status='canceled' WHERE contact_id=? AND status='queued'",
      ).bind(id),
    ]);
  return new Response(
    match[1] === 'verify'
      ? '已确认，之后这条评论收到回复时将发送邮件。'
      : '已退订并移除这条评论保存的邮箱。',
    {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    },
  );
}

export async function deliverCommentMail(env: CommentMailEnv) {
  if (!env.DB) return { enabled: false, sent: 0 };
  const db = env.DB;
  await ensureInitialSchema(db);
  const now = Math.floor(Date.now() / 1000);
  // A crashed sender may have reached the provider. Do not blindly resend.
  await db
    .prepare(
      "UPDATE comment_mail SET status='uncertain' WHERE status='sending' AND next_at<?",
    )
    .bind(now)
    .run();
  await db
    .prepare(
      "UPDATE comment_mail SET status='canceled' WHERE status='queued' AND created_at<?",
    )
    .bind(now - 86400)
    .run();
  await db
    .prepare(
      "UPDATE comment_email_contacts SET email='',revoked_at=? WHERE confirmed_at IS NULL AND revoked_at IS NULL AND created_at<?",
    )
    .bind(now, now - 86400)
    .run();
  if (!mailConfigured(env)) return { enabled: false, sent: 0 };
  const jobs = await db
    .prepare(
      "SELECT m.* FROM comment_mail m JOIN comment_email_contacts e ON e.comment_id=m.contact_id WHERE m.status='queued' AND m.next_at<=? AND (m.kind='verify' OR e.confirmed_at IS NOT NULL OR e.revoked_at IS NOT NULL) ORDER BY m.created_at,m.id LIMIT 2",
    )
    .bind(now)
    .all<{
      id: string;
      kind: string;
      contact_id: string;
      reply_id: string | null;
      created_at: number;
      attempts: number;
    }>();
  let sent = 0;
  for (const job of jobs.results) {
    const contact = await db
      .prepare(
        'SELECT email,confirmed_at,revoked_at,created_at FROM comment_email_contacts WHERE comment_id=?',
      )
      .bind(job.contact_id)
      .first<{
        email: string;
        confirmed_at: number | null;
        revoked_at: number | null;
        created_at: number;
      }>();
    const parent = await db
      .prepare(
        'SELECT id,post_id,nickname,status,parent_id FROM comments WHERE id=?',
      )
      .bind(job.contact_id)
      .first<{
        id: string;
        post_id: string;
        nickname: string;
        status: string;
        parent_id: string | null;
      }>();
    const post =
      parent && (await contentRepository(db).getPublished(parent.post_id));
    const root = parent?.parent_id
      ? await db
          .prepare('SELECT status FROM comments WHERE id=?')
          .bind(parent.parent_id)
          .first<{ status: string }>()
      : null;
    const reply = job.reply_id
      ? await db
          .prepare('SELECT body,nickname,status FROM comments WHERE id=?')
          .bind(job.reply_id)
          .first<{ body: string; nickname: string; status: string }>()
      : null;
    if (
      !contact?.email ||
      contact.revoked_at !== null ||
      !parent ||
      !['approved', 'pending'].includes(parent.status) ||
      !post ||
      (parent?.parent_id &&
        (!root || !['approved', 'pending'].includes(root.status))) ||
      (job.kind === 'reply' &&
        (!reply || !['approved', 'pending'].includes(reply.status))) ||
      (job.kind === 'verify' && contact.confirmed_at !== null)
    ) {
      await db
        .prepare(
          "UPDATE comment_mail SET status='canceled' WHERE id=? AND status='queued'",
        )
        .bind(job.id)
        .run();
      continue;
    }
    const claimed = await db
      .prepare(
        "UPDATE comment_mail SET status='sending',attempts=attempts+1,next_at=? WHERE id=? AND status='queued' RETURNING id",
      )
      .bind(now + 120, job.id)
      .first();
    if (!claimed) continue;
    const day = Math.floor((now + 28800) / 86400);
    const budget = await db
      .prepare(
        'INSERT INTO comment_limits(bucket,window,count) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window WHERE window<>excluded.window OR count<? RETURNING count',
      )
      .bind('mail-global', day, Number(env.MAIL_DAILY_LIMIT ?? 100))
      .first();
    if (!budget) {
      await db
        .prepare(
          "UPDATE comment_mail SET status='queued',next_at=? WHERE id=? AND status='sending'",
        )
        .bind((day + 1) * 86400 - 28800, job.id)
        .run();
      continue;
    }
    try {
      const unsubscribe = new URL(
        '/api/comment-email/unsubscribe',
        env.SITE_URL,
      );
      unsubscribe.searchParams.set(
        'token',
        await token(env, job.contact_id, 'unsubscribe', job.created_at),
      );
      const original = new URL(post.canonicalPath, env.SITE_URL);
      original.hash = 'comment-' + job.contact_id;
      let text: string;
      if (job.kind === 'verify') {
        const verify = new URL('/api/comment-email/verify', env.SITE_URL);
        verify.searchParams.set(
          'token',
          await token(env, job.contact_id, 'verify', contact.created_at),
        );
        text = `你在 SFSafi 的个人空间评论时填写了这个邮箱。\n请打开链接并确认订阅（24 小时内有效）：\n${verify}\n\n评论：${original}\n\n如果不是你填写的，请忽略；不会发送回复通知。\n停止通知：${unsubscribe}`;
      } else {
        text = `你的评论收到 ${reply!.nickname} 的回复：\n\n${reply!.body}\n\n查看回复：${new URL(post.canonicalPath + '#comment-' + job.reply_id, env.SITE_URL)}\n\n停止通知并移除邮箱：${unsubscribe}`;
      }
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + env.RESEND_API_KEY,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'comment-' + job.id,
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [contact.email],
          subject:
            job.kind === 'verify'
              ? '确认评论回复邮件通知'
              : '你的评论收到了回复',
          text,
        }),
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) {
        const data = (await response.json()) as { id?: unknown };
        if (typeof data.id !== 'string' || !data.id || data.id.length > 200)
          throw Error();
        await db
          .prepare(
            "UPDATE comment_mail SET status='sent',provider_id=?,sent_at=? WHERE id=? AND status='sending'",
          )
          .bind(data.id, now, job.id)
          .run();
        sent++;
      } else if (response.status === 429 && job.attempts < 2) {
        await db
          .prepare(
            "UPDATE comment_mail SET status='queued',next_at=? WHERE id=? AND status='sending'",
          )
          .bind(now + 300 * (job.attempts + 1), job.id)
          .run();
      } else {
        await db
          .prepare(
            "UPDATE comment_mail SET status=? WHERE id=? AND status='sending'",
          )
          .bind(response.status >= 500 ? 'uncertain' : 'failed', job.id)
          .run();
      }
    } catch {
      // Do not log email addresses, token links, credentials or provider response bodies.
      await db
        .prepare(
          "UPDATE comment_mail SET status='uncertain' WHERE id=? AND status='sending'",
        )
        .bind(job.id)
        .run();
    }
  }
  return { enabled: true, sent };
}
