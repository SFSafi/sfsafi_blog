import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import type { D1Database } from '@cloudflare/workers-types';
import { ensureBotSchema } from './schema';
import { readLimitedText } from '../worker/http';
import { verifyBody } from '../worker/service-sign';
export interface BotEnv {
  DB: D1Database;
  QQ_APP_ID?: string;
  QQ_APP_SECRET?: string;
  QQ_SITE_SECRET?: string;
  SITE_URL?: string;
  QQ_GROUP_IDS?: string;
  QQ_GROUP_OPERATOR_IDS?: string;
}
interface Context {
  waitUntil(work: Promise<unknown>): void;
}
interface Native {
  kind: 'group' | 'user';
  target: string;
  actor: string;
  command: string;
  messageId?: string;
  eventTime: string;
  revoke?: boolean;
}
interface Event {
  id?: string;
  eventId: string;
  postId: string;
  revision: number;
  eventType: string;
  occurredAt: string;
  title: string;
  excerpt: string;
  tags: string[];
  url: string;
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
const list = (value?: string) =>
  new Set(
    (value || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  );
function keys(secret: string) {
  let seed = Buffer.from(secret);
  while (seed.length < 32) seed = Buffer.concat([seed, seed]);
  return createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      seed.subarray(0, 32),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
}
function authenticatedQQ(request: Request, body: string, secret: string) {
  const stamp = request.headers.get('X-Signature-Timestamp'),
    signature = request.headers.get('X-Signature-Ed25519');
  if (
    !stamp ||
    !/^\d{10,11}$/.test(stamp) ||
    Math.abs(Number(stamp) - Date.now() / 1000) > 300 ||
    !signature ||
    !/^[a-fA-F0-9]{128}$/.test(signature)
  )
    return false;
  return verify(
    null,
    Buffer.from(stamp + body),
    createPublicKey(keys(secret)),
    Buffer.from(signature, 'hex'),
  );
}
const tokens = new Map<string, { token: string; expires: number }>();
async function qqToken(env: BotEnv) {
  const cacheKey = env.QQ_APP_ID + ':' + env.QQ_APP_SECRET,
    old = tokens.get(cacheKey);
  if (old && old.expires > Date.now() + 60000) return old.token;
  const response = await fetch('https://api.bot.qq.com/app/getAppAccessToken', {
    method: 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(8000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appId: env.QQ_APP_ID,
      clientSecret: env.QQ_APP_SECRET,
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw Error('QQ 凭证 HTTP ' + response.status);
  }
  const data = JSON.parse(await readLimitedText(response, 16384));
  if (typeof data.access_token !== 'string' || Number(data.expires_in) < 30)
    throw Error('QQ 凭证响应无效');
  tokens.set(cacheKey, {
    token: data.access_token,
    expires: Date.now() + Math.min(7200, Number(data.expires_in)) * 1000,
  });
  return data.access_token as string;
}
class UncertainDelivery extends Error {}
async function sendQQ(
  env: BotEnv,
  kind: string,
  target: string,
  content: string,
  messageId?: string,
) {
  // Token failures happen before sending a message and are safe to retry.
  const token = await qqToken(env);
  let response: Response;
  try {
    response = await fetch(
      `https://api.bot.qq.com/v2/${kind === 'group' ? 'groups' : 'users'}/${encodeURIComponent(target)}/messages`,
      {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'QQBot ' + token,
        },
        body: JSON.stringify({
          content,
          msg_type: 0,
          ...(messageId ? { msg_id: messageId, msg_seq: 1 } : {}),
        }),
      },
    );
  } catch {
    throw new UncertainDelivery();
  }
  if (!response.ok) {
    if (response.status === 401) tokens.clear();
    await response.body?.cancel();
    if (response.status >= 500) throw new UncertainDelivery();
    throw Error('QQ HTTP ' + response.status);
  }
  let data: any;
  try {
    data = JSON.parse(await readLimitedText(response, 16384));
  } catch {
    throw new UncertainDelivery();
  }
  if (Number.isInteger(data.code) && data.code !== 0)
    throw Error('QQ code ' + data.code);
  if (typeof data.id !== 'string' || !data.id) throw new UncertainDelivery();
  return data.id as string;
}
function native(payload: any, env: BotEnv): Native | undefined {
  const d = payload.d || {},
    type = payload.t;
  if (
    ['GROUP_MSG_REJECT', 'GROUP_DEL_ROBOT'].includes(type) &&
    typeof d.group_openid === 'string'
  )
    return {
      kind: 'group',
      target: d.group_openid,
      actor: '',
      command: '',
      eventTime: new Date().toISOString(),
      revoke: true,
    };
  if (
    type === 'C2C_MSG_REJECT' &&
    typeof (d.openid || d.user_openid) === 'string'
  )
    return {
      kind: 'user',
      target: d.openid || d.user_openid,
      actor: d.openid || d.user_openid,
      command: '',
      eventTime: new Date().toISOString(),
      revoke: true,
    };
  if (
    !['GROUP_AT_MESSAGE_CREATE', 'C2C_MESSAGE_CREATE'].includes(type) ||
    typeof d.content !== 'string'
  )
    return;
  const group = type === 'GROUP_AT_MESSAGE_CREATE',
    target = group ? d.group_openid : d.author?.user_openid || d.author?.id,
    actor = group ? d.author?.member_openid : target;
  if (
    typeof target !== 'string' ||
    typeof actor !== 'string' ||
    target.length > 128 ||
    actor.length > 128 ||
    !target ||
    !actor
  )
    return;
  if (
    group &&
    (!list(env.QQ_GROUP_IDS).has(target) ||
      !list(env.QQ_GROUP_OPERATOR_IDS).has(actor))
  )
    return;
  const command = d.content
    .replace(/<@!?[^>]+>/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^\//, '');
  if (!/^(订阅(?:\s+#[^\s]{1,30})?|退订|取消订阅|查看订阅)$/.test(command))
    return;
  return {
    kind: group ? 'group' : 'user',
    target,
    actor,
    command,
    messageId: typeof d.id === 'string' ? d.id : undefined,
    eventTime:
      typeof d.timestamp === 'string' ? d.timestamp : new Date().toISOString(),
  };
}
export async function processNative(env: BotEnv) {
  const now = Math.floor(Date.now() / 1000);
  const rows = await env.DB.prepare(
    "SELECT id FROM qq_native_inbox WHERE state='pending' AND lease_until<=? LIMIT 2",
  )
    .bind(now)
    .all<{ id: string }>();
  for (const row of rows.results) {
    const claimed = await env.DB.prepare(
      "UPDATE qq_native_inbox SET lease_until=? WHERE id=? AND state='pending' AND lease_until<=? RETURNING payload",
    )
      .bind(now + 60, row.id, now)
      .first<{ payload: string }>();
    if (!claimed) continue;
    try {
      const n = JSON.parse(claimed.payload) as Native,
        id = n.kind + ':' + n.target;
      let reply = '';
      if (n.revoke) {
        await env.DB.prepare(
          "UPDATE qq_subscriptions SET status='unsubscribed' WHERE id=?",
        )
          .bind(id)
          .run();
      } else if (n.command === '退订' || n.command === '取消订阅') {
        await env.DB.prepare(
          "UPDATE qq_subscriptions SET status='unsubscribed' WHERE id=?",
        )
          .bind(id)
          .run();
        reply = '已取消本站更新订阅。';
      } else if (n.command === '查看订阅') {
        const sub = await env.DB.prepare(
          'SELECT tags,status FROM qq_subscriptions WHERE id=?',
        )
          .bind(id)
          .first<{ tags: string; status: string }>();
        reply =
          sub?.status === 'active'
            ? '已订阅：' + (JSON.parse(sub.tags).join('、') || '全部更新')
            : '当前没有有效订阅。';
      } else {
        const tags = n.command.startsWith('订阅 #') ? [n.command.slice(4)] : [];
        await env.DB.prepare(
          "INSERT INTO qq_subscriptions(id,kind,target,actor,tags,status,created_at) VALUES(?,?,?,?,?,'active',?) ON CONFLICT(id) DO UPDATE SET tags=excluded.tags,status='active',actor=excluded.actor,created_at=excluded.created_at",
        )
          .bind(
            id,
            n.kind,
            n.target,
            n.actor,
            JSON.stringify(tags),
            new Date().toISOString(),
          )
          .run();
        reply =
          '已订阅本站' +
          (tags.length ? ' #' + tags[0] : '全部') +
          '更新。发送“退订”可取消。';
      }
      await env.DB.prepare(
        "UPDATE qq_native_inbox SET state='done',lease_until=0 WHERE id=?",
      )
        .bind(row.id)
        .run();
      if (
        reply &&
        n.messageId &&
        Math.abs(Date.now() - Date.parse(n.eventTime)) < 4 * 60000
      ) {
        try {
          if (
            !(await quota(env.DB, 'global', Math.floor(Date.now() / 60000), 10))
          )
            continue;
          await sendQQ(env, n.kind, n.target, reply, n.messageId);
        } catch {
          /* Command persisted; a provider acknowledgement failure is not a lost subscription. */
        }
      }
    } catch {
      await env.DB.prepare(
        'UPDATE qq_native_inbox SET lease_until=0 WHERE id=?',
      )
        .bind(row.id)
        .run();
    }
  }
}
async function fanout(env: BotEnv) {
  const now = Math.floor(Date.now() / 1000);
  const event = await env.DB.prepare(
    "UPDATE qq_events SET lease_until=? WHERE id=(SELECT id FROM qq_events WHERE state='pending' AND lease_until<=? ORDER BY received_at LIMIT 1) AND lease_until<=? RETURNING id,payload,cursor",
  )
    .bind(now + 60, now, now)
    .first<{ id: string; payload: string; cursor: string }>();
  if (!event) return;
  try {
    const payload = JSON.parse(event.payload) as Event;
    const subs = await env.DB.prepare(
      "SELECT id,tags FROM qq_subscriptions WHERE status='active' AND id>? AND created_at<=? ORDER BY id LIMIT 6",
    )
      .bind(event.cursor, payload.occurredAt)
      .all<{ id: string; tags: string }>();
    const page = subs.results.slice(0, 5);
    const inserts = page
      .filter((s) => {
        const tags = JSON.parse(s.tags) as string[];
        return !tags.length || tags.some((t) => payload.tags.includes(t));
      })
      .map((s) =>
        env.DB.prepare(
          'INSERT OR IGNORE INTO qq_deliveries(id,event_id,subscription_id) VALUES(?,?,?)',
        ).bind(event.id + '|' + s.id, event.id, s.id),
      );
    inserts.push(
      env.DB.prepare(
        'UPDATE qq_events SET cursor=?,state=?,lease_until=0 WHERE id=?',
      ).bind(
        page.at(-1)?.id || event.cursor,
        subs.results.length > 5 ? 'pending' : 'done',
        event.id,
      ),
    );
    await env.DB.batch(inserts);
  } catch {
    await env.DB.prepare('UPDATE qq_events SET lease_until=0 WHERE id=?')
      .bind(event.id)
      .run();
  }
}
async function quota(db: D1Database, key: string, window: number, cap: number) {
  return !!(await db
    .prepare(
      'INSERT INTO qq_limits(bucket,window,count) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window WHERE window<>excluded.window OR count<? RETURNING count',
    )
    .bind(key, window, cap)
    .first());
}
export async function processBot(env: BotEnv) {
  if (!env.DB || !env.QQ_APP_ID || !env.QQ_APP_SECRET || !env.SITE_URL) return;
  await ensureBotSchema(env.DB);
  await processNative(env);
  await fanout(env);
  const now = Math.floor(Date.now() / 1000);
  const rows = await env.DB.prepare(
    "SELECT id FROM qq_deliveries WHERE state='pending' AND next_attempt_at<=? AND lease_until<=? ORDER BY id LIMIT 2",
  )
    .bind(now, now)
    .all<{ id: string }>();
  for (const row of rows.results) {
    const job = await env.DB.prepare(
      "UPDATE qq_deliveries SET lease_until=? WHERE id=? AND state='pending' AND lease_until<=? RETURNING event_id,subscription_id,attempts",
    )
      .bind(now + 90, row.id, now)
      .first<{ event_id: string; subscription_id: string; attempts: number }>();
    if (!job) continue;
    try {
      const sub = await env.DB.prepare(
        'SELECT kind,target,status,tags FROM qq_subscriptions WHERE id=?',
      )
        .bind(job.subscription_id)
        .first<{
          kind: string;
          target: string;
          status: string;
          tags: string;
        }>();
      const event = await env.DB.prepare(
        'SELECT payload FROM qq_events WHERE id=?',
      )
        .bind(job.event_id)
        .first<{ payload: string }>();
      if (!sub || sub.status !== 'active' || !event) {
        await env.DB.prepare(
          "UPDATE qq_deliveries SET state='cancelled',lease_until=0 WHERE id=?",
        )
          .bind(row.id)
          .run();
        continue;
      }
      if (sub.kind === 'group' && !list(env.QQ_GROUP_IDS).has(sub.target)) {
        await env.DB.prepare(
          "UPDATE qq_deliveries SET state='cancelled',lease_until=0,last_error='群授权已移除' WHERE id=?",
        )
          .bind(row.id)
          .run();
        continue;
      }
      const payload = JSON.parse(event.payload) as Event;
      const activeTags = JSON.parse(sub.tags) as string[];
      if (
        activeTags.length &&
        !activeTags.some((tag) => payload.tags.includes(tag))
      ) {
        await env.DB.prepare(
          "UPDATE qq_deliveries SET state='cancelled',lease_until=0,last_error='订阅筛选已更新' WHERE id=?",
        )
          .bind(row.id)
          .run();
        continue;
      }
      const site = new URL(env.SITE_URL);
      if (new URL(payload.url).origin !== site.origin)
        throw Error('站点地址无效');
      const visible = await fetch(payload.url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      });
      if (visible.status === 404) {
        await visible.body?.cancel();
        await env.DB.prepare(
          "UPDATE qq_deliveries SET state='cancelled',lease_until=0,last_error='内容已撤回' WHERE id=?",
        )
          .bind(row.id)
          .run();
        continue;
      }
      if (!visible.ok) {
        await visible.body?.cancel();
        throw Error('公开页面不可用');
      }
      const html = await readLimitedText(visible, 200000),
        revision = Number(html.match(/data-post-revision="(\d+)"/)?.[1]);
      if (revision < payload.revision || !revision)
        throw Error('公开版本未确认');
      if (
        !(await quota(env.DB, 'global', Math.floor(now / 60), 10)) ||
        !(await quota(
          env.DB,
          job.subscription_id,
          Math.floor(now / 86400),
          sub.kind === 'group' ? 100 : 30,
        ))
      ) {
        await env.DB.prepare(
          'UPDATE qq_deliveries SET lease_until=0,next_attempt_at=? WHERE id=?',
        )
          .bind(now + 3600, row.id)
          .run();
        continue;
      }
      let messageId: string;
      try {
        messageId = await sendQQ(
          env,
          sub.kind,
          sub.target,
          `${payload.title}\n${payload.excerpt}\n${payload.url}`,
        );
      } catch (error) {
        const uncertain = error instanceof UncertainDelivery;
        if (uncertain) {
          await env.DB.prepare(
            "UPDATE qq_deliveries SET state='uncertain',lease_until=0,last_error='网络结果不确定，需核对，未自动重发' WHERE id=?",
          )
            .bind(row.id)
            .run();
          continue;
        }
        throw error;
      }
      await env.DB.prepare(
        "UPDATE qq_deliveries SET state='sent',message_id=?,sent_at=?,lease_until=0,last_error=NULL WHERE id=?",
      )
        .bind(messageId, new Date().toISOString(), row.id)
        .run();
    } catch (error) {
      const attempts = job.attempts + 1;
      const reason =
        error instanceof Error &&
        /^QQ (?:HTTP \d{3}|code \d+)$/.test(error.message)
          ? error.message
          : '投递暂不可用';
      await env.DB.prepare(
        'UPDATE qq_deliveries SET state=?,attempts=?,next_attempt_at=?,lease_until=0,last_error=? WHERE id=?',
      )
        .bind(
          attempts >= 5 ? 'failed' : 'pending',
          attempts,
          now + Math.min(3600, 60 * 2 ** attempts),
          reason,
          row.id,
        )
        .run();
    }
  }
}
export default {
  async fetch(request: Request, env: BotEnv, ctx: Context): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET')
      return json({
        ok: true,
        configured: !!(
          env.DB &&
          env.QQ_APP_ID &&
          env.QQ_APP_SECRET &&
          env.QQ_SITE_SECRET &&
          env.SITE_URL
        ),
      });
    if (!['/qq/events', '/site-updates'].includes(url.pathname))
      return json({ error: 'Not found' }, 404);
    if (request.method !== 'POST')
      return json({ error: 'Method not allowed' }, 405);
    if (!env.DB) return json({ error: 'Bot storage not configured' }, 503);
    let raw: string;
    try {
      raw = await readLimitedText(request, 65536);
    } catch {
      return json({ error: 'Payload too large' }, 413);
    }
    if (url.pathname === '/site-updates') {
      if (
        !env.QQ_SITE_SECRET ||
        env.QQ_SITE_SECRET.length < 32 ||
        !env.SITE_URL
      )
        return json({ error: 'Site integration not configured' }, 503);
      if (
        !(await verifyBody(
          env.QQ_SITE_SECRET,
          request.headers.get('X-Space-Timestamp'),
          raw,
          request.headers.get('X-Space-Signature'),
        ))
      )
        return json({ error: 'Unauthorized' }, 401);
      let event: Event;
      try {
        event = JSON.parse(raw);
        if (
          typeof event.eventId !== 'string' ||
          event.eventId.length > 140 ||
          typeof event.postId !== 'string' ||
          !/^[a-z0-9-]{1,100}$/.test(event.postId) ||
          event.eventId !== 'first-published:' + event.postId ||
          event.eventType !== 'first_published' ||
          !Number.isInteger(event.revision) ||
          event.revision < 1 ||
          typeof event.title !== 'string' ||
          event.title.length > 500 ||
          typeof event.excerpt !== 'string' ||
          event.excerpt.length > 1000 ||
          !Array.isArray(event.tags) ||
          event.tags.length > 8 ||
          event.tags.some((t) => typeof t !== 'string' || t.length > 30) ||
          !Number.isFinite(Date.parse(event.occurredAt)) ||
          new URL(event.url).href !==
            new URL('/posts/' + event.postId + '/', env.SITE_URL).href
        )
          throw Error();
      } catch {
        return json({ error: 'Invalid update event' }, 400);
      }
      await ensureBotSchema(env.DB);
      await env.DB.prepare(
        'INSERT OR IGNORE INTO qq_events(id,payload,received_at) VALUES(?,?,?)',
      )
        .bind(event.eventId, JSON.stringify(event), new Date().toISOString())
        .run();
      ctx.waitUntil(processBot(env));
      return json({ accepted: true, eventId: event.eventId });
    }
    if (!env.QQ_APP_SECRET)
      return json({ error: 'QQ app not configured' }, 503);
    if (!authenticatedQQ(request, raw, env.QQ_APP_SECRET))
      return json({ error: 'Unauthorized' }, 401);
    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }
    if (payload.op === 13) {
      const d = payload.d;
      if (
        typeof d?.plain_token !== 'string' ||
        d.plain_token.length > 256 ||
        typeof d.event_ts !== 'string'
      )
        return json({ error: 'Invalid challenge' }, 400);
      return json({
        plain_token: d.plain_token,
        signature: sign(
          null,
          Buffer.from(d.event_ts + d.plain_token),
          keys(env.QQ_APP_SECRET),
        ).toString('hex'),
      });
    }
    if (
      payload.t === 'GROUP_AT_MESSAGE_CREATE' &&
      typeof payload.d?.group_openid === 'string' &&
      typeof payload.d?.author?.member_openid === 'string'
    ) {
      const group = payload.d.group_openid,
        actor = payload.d.author.member_openid;
      if (group.length <= 128 && actor.length <= 128) {
        await ensureBotSchema(env.DB);
        await env.DB.prepare(
          'INSERT INTO qq_group_requests(id,group_id,actor_id,seen_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET seen_at=excluded.seen_at',
        )
          .bind(group + ':' + actor, group, actor, new Date().toISOString())
          .run();
      }
    }
    const normalized = native(payload, env);
    if (normalized) {
      const id = payload.id || payload.d?.id;
      if (typeof id !== 'string' || !id || id.length > 200)
        return json({ error: 'Invalid event ID' }, 400);
      await ensureBotSchema(env.DB);
      await env.DB.prepare(
        'INSERT OR IGNORE INTO qq_native_inbox(id,payload) VALUES(?,?)',
      )
        .bind(id, JSON.stringify(normalized))
        .run();
      ctx.waitUntil(processBot(env));
    }
    return json({ op: 12 });
  },
  scheduled(_event: unknown, env: BotEnv, ctx: Context) {
    ctx.waitUntil(processBot(env));
  },
};
