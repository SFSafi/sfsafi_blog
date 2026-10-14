import type { D1Database } from '@cloudflare/workers-types';
const cookieName = 'space_visitor';
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function json(data: unknown, status = 200, cookie?: string) {
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
export async function visitor(
  request: Request,
  db: D1Database,
  create: boolean,
) {
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
export async function limit(db: D1Database, id: string) {
  const result = await db
    .prepare(
      'INSERT INTO rate_limits(visitor_id,window,count) VALUES(?,?,1) ON CONFLICT(visitor_id) DO UPDATE SET count=CASE WHEN window=excluded.window THEN count+1 ELSE 1 END,window=excluded.window WHERE window<>excluded.window OR count<60 RETURNING count',
    )
    .bind(id, Math.floor(Date.now() / 60000))
    .first();
  if (!result) throw new HttpError(429, '操作太频繁。');
}
