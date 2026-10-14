import { ensureBotSchema } from '../bot/schema';
import { requireOwner, json, type OwnerEnv } from './owner';
import { readLimitedText } from './http';
export async function qqAdminRoute(
  request: Request,
  env: OwnerEnv,
): Promise<Response | undefined> {
  const url = new URL(request.url),
    retry = url.pathname === '/api/admin/qq/retry';
  if (!retry && url.pathname !== '/api/admin/qq') return;
  const denied = await requireOwner(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: 'Bot 存储尚未配置。' }, 503);
  try {
    await ensureBotSchema(env.DB);
    if (!retry && request.method === 'GET') {
      const subscriptions = await env.DB.prepare(
        'SELECT kind,status,count(*) AS count FROM qq_subscriptions GROUP BY kind,status',
      ).all();
      const groups = await env.DB.prepare(
        'SELECT group_id,actor_id,seen_at FROM qq_group_requests ORDER BY seen_at DESC LIMIT 20',
      ).all();
      const jobs = await env.DB.prepare(
        'SELECT id,event_id,state,attempts,last_error,message_id,sent_at FROM qq_deliveries ORDER BY rowid DESC LIMIT 20',
      ).all();
      return json({
        subscriptions: subscriptions.results,
        groups: groups.results,
        jobs: jobs.results,
      });
    }
    if (!retry || request.method !== 'POST')
      return json({ error: '请求方法不支持。' }, 405);
    if (request.headers.get('Origin') !== url.origin)
      return json({ error: '请求来源无效。' }, 403);
    if (!request.headers.get('Content-Type')?.startsWith('application/json'))
      return json({ error: '需要 JSON 请求。' }, 415);
    const body = JSON.parse(await readLimitedText(request, 2048));
    if (
      typeof body?.id !== 'string' ||
      body.id.length > 300 ||
      !['site', 'bot'].includes(body.source) ||
      !['failed', 'uncertain'].includes(body.state)
    )
      return json({ error: '重试参数无效。' }, 400);
    if (body.state === 'uncertain' && body.confirmUncertain !== true)
      return json(
        { error: '结果不确定，需核对 QQ 是否已送达并确认可能重复后才可重试。' },
        409,
      );
    const statement =
      body.source === 'site'
        ? env.DB.prepare(
            "UPDATE publication_outbox SET state='pending',attempts=0,next_attempt_at=0,lease_until=0,last_error='站主手动重试' WHERE event_id=? AND state=? RETURNING event_id",
          )
        : env.DB.prepare(
            "UPDATE qq_deliveries SET state='pending',attempts=0,next_attempt_at=0,lease_until=0,last_error='站主手动重试' WHERE id=? AND state=? RETURNING id",
          );
    const row = await statement.bind(body.id, body.state).first();
    return row
      ? json({ queued: true })
      : json({ error: '任务状态已改变，请刷新。' }, 409);
  } catch {
    return json({ error: 'Bot 状态读取或更新失败，请重试。' }, 503);
  }
}
