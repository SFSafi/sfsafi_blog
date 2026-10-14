import { requireOwner, json, type OwnerEnv } from './owner';
import { contentRepository, ensureContentSeed } from './content-repository';
import { ensureInitialSchema } from './schema';
import { signBody } from './service-sign';
import { readLimitedText } from './http';
export interface NotificationEnv extends OwnerEnv {
  QQ_BOT_WEBHOOK_URL?: string;
  QQ_SITE_SECRET?: string;
  SITE_URL?: string;
}
export function notificationsConfigured(env: NotificationEnv) {
  return !!(
    env.DB &&
    env.QQ_BOT_WEBHOOK_URL &&
    env.QQ_SITE_SECRET &&
    env.QQ_SITE_SECRET.length >= 32 &&
    env.SITE_URL
  );
}
export async function deliverUpdates(env: NotificationEnv) {
  if (!notificationsConfigured(env)) return { enabled: false, accepted: 0 };
  let endpoint: URL, site: URL;
  try {
    endpoint = new URL(env.QQ_BOT_WEBHOOK_URL!);
    site = new URL(env.SITE_URL!);
    if (
      endpoint.protocol !== 'https:' ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      site.protocol !== 'https:' ||
      site.username ||
      site.password ||
      site.pathname !== '/' ||
      site.search ||
      site.hash
    )
      throw Error();
  } catch {
    return { enabled: false, accepted: 0 };
  }
  const db = env.DB!;
  await ensureInitialSchema(db);
  await ensureContentSeed(db);
  const now = Math.floor(Date.now() / 1000);
  const rows = await db
    .prepare(
      "SELECT event_id FROM publication_outbox WHERE state='pending' AND next_attempt_at<=? AND lease_until<=? ORDER BY event_id LIMIT 3",
    )
    .bind(now, now)
    .all<{ event_id: string }>();
  let accepted = 0;
  for (const candidate of rows.results) {
    const job = await db
      .prepare(
        "UPDATE publication_outbox SET lease_until=? WHERE event_id=? AND state='pending' AND lease_until<=? RETURNING event_id,post_id,revision,payload,attempts",
      )
      .bind(now + 90, candidate.event_id, now)
      .first<{
        event_id: string;
        post_id: string;
        revision: number;
        payload: string;
        attempts: number;
      }>();
    if (!job) continue;
    let failure = '暂不可用';
    try {
      const post = await contentRepository(db).getPublished(job.post_id);
      if (!post) {
        await db
          .prepare(
            "UPDATE publication_outbox SET state='cancelled',lease_until=0,last_error='内容已撤回' WHERE event_id=?",
          )
          .bind(job.event_id)
          .run();
        continue;
      }
      const response = await fetch(new URL(post.canonicalPath, site), {
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        failure = '公开页面尚不可访问';
        throw Error();
      }
      const page = await readLimitedText(response, 200000);
      if (!page.includes(`data-post-revision="${post.revision}"`)) {
        failure = '公开页面版本尚未匹配';
        throw Error();
      }
      const original = JSON.parse(job.payload);
      const event = {
        ...original,
        revision: post.revision,
        title: post.title || post.body.slice(0, 60),
        excerpt: post.excerpt || post.body.slice(0, 200),
        tags: post.tags,
        url: new URL(post.canonicalPath, site).href,
      };
      const body = JSON.stringify(event),
        timestamp = String(Math.floor(Date.now() / 1000));
      const delivery = await fetch(endpoint, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
        headers: {
          'Content-Type': 'application/json',
          'X-Space-Timestamp': timestamp,
          'X-Space-Signature': await signBody(
            env.QQ_SITE_SECRET!,
            timestamp,
            body,
          ),
        },
        body,
      });
      if (!delivery.ok) {
        failure = 'Bot HTTP ' + delivery.status;
        await delivery.body?.cancel();
        throw Error();
      }
      const ack = JSON.parse(await readLimitedText(delivery, 4096));
      if (ack.accepted !== true || ack.eventId !== job.event_id) {
        failure = 'Bot 未确认持久接收';
        throw Error();
      }
      await db
        .prepare(
          "UPDATE publication_outbox SET state='accepted',delivered_at=?,lease_until=0,last_error=NULL WHERE event_id=?",
        )
        .bind(new Date().toISOString(), job.event_id)
        .run();
      accepted++;
    } catch {
      const attempts = job.attempts + 1;
      await db
        .prepare(
          'UPDATE publication_outbox SET state=?,attempts=?,next_attempt_at=?,lease_until=0,last_error=? WHERE event_id=?',
        )
        .bind(
          attempts >= 8 ? 'failed' : 'pending',
          attempts,
          now + Math.min(3600, 60 * 2 ** attempts),
          failure,
          job.event_id,
        )
        .run();
    }
  }
  return { enabled: true, accepted };
}
export async function notificationRoute(
  request: Request,
  env: NotificationEnv,
): Promise<Response | undefined> {
  if (new URL(request.url).pathname !== '/api/admin/notifications') return;
  const denied = await requireOwner(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: '事件存储尚未配置。' }, 503);
  if (request.method !== 'GET') return json({ error: '请求方法不支持。' }, 405);
  const rows = await env.DB.prepare(
    'SELECT event_id,post_id,revision,state,attempts,last_error,delivered_at FROM publication_outbox ORDER BY rowid DESC LIMIT 20',
  ).all();
  return json({
    configured: notificationsConfigured(env),
    items: rows.results,
  });
}
