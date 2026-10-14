import type { ProfileEnv } from './profile';
import { verifyAccessToken } from './access';
export interface OwnerEnv extends ProfileEnv {
  OWNER_EMAIL?: string;
}
export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
export async function requireOwner(
  request: Request,
  env: OwnerEnv,
): Promise<Response | null> {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return json({ error: '请先通过 Cloudflare Access 登录。' }, 401);
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.OWNER_EMAIL)
    return json(
      { error: '站主登录尚未配置，请设置 Access 与 OWNER_EMAIL。' },
      503,
    );
  try {
    const email = await verifyAccessToken(token, env);
    if (email.toLowerCase() !== env.OWNER_EMAIL.trim().toLowerCase())
      return json({ error: '只有站主可以执行此操作。' }, 403);
  } catch {
    return json({ error: '登录已失效或无权访问。' }, 403);
  }
  return null;
}
