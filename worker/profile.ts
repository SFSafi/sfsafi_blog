import type { D1Database } from '@cloudflare/workers-types';
import { imageSize } from 'image-size';
import { repository } from '../src/lib/content';
import { verifyAccessToken, type AccessConfig } from './access';
export interface ProfileEnv extends AccessConfig {
  DB?: D1Database;
}
function result(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
export async function publicProfile(env: ProfileEnv) {
  const fallback = await repository.getProfile();
  const row = await env
    .DB!.prepare(
      'SELECT nickname,bio,location,avatar_id,updated_at FROM profile WHERE id=1',
    )
    .first<{
      nickname: string;
      bio: string;
      location: string;
      avatar_id: string | null;
      updated_at: string;
    }>();
  return {
    name: row?.nickname || fallback.name,
    bio: row?.bio ?? fallback.bio,
    location: row?.location ?? fallback.location,
    handle: fallback.handle,
    avatarUrl: row?.avatar_id
      ? `/api/avatars/${row.avatar_id}`
      : '/media/avatar.svg',
    updatedAt: row?.updated_at ?? null,
  };
}
export async function requireAdmin(
  request: Request,
  env: ProfileEnv,
): Promise<Response | null> {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token)
    return result({ error: '请先通过 Cloudflare Access 登录。' }, 401);
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD)
    return result({ error: '管理员登录尚未配置。' }, 503);
  try {
    await verifyAccessToken(token, env);
  } catch {
    return result({ error: '登录已失效或无权访问。' }, 403);
  }

  return null;
}
export async function profileRoute(
  request: Request,
  env: ProfileEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const admin = url.pathname === '/api/admin/profile';
  const avatar = url.pathname.match(/^\/api\/avatars\/([a-f0-9-]{36})$/);
  if (url.pathname !== '/api/profile' && !admin && !avatar) return null;
  if (admin) {
    const denied = await requireAdmin(request, env);
    if (denied) return denied;
  }
  if (!env.DB) return result({ error: '资料存储尚未配置。' }, 503);
  try {
    if (avatar) {
      if (request.method !== 'GET')
        return result({ error: '请求方法不支持。' }, 405);
      const row = await env.DB.prepare(
        'SELECT mime_type,bytes FROM avatars WHERE id=?',
      )
        .bind(avatar[1])
        .first<{ mime_type: string; bytes: number[] }>();
      if (!row) return result({ error: '头像不存在。' }, 404);
      return new Response(new Uint8Array(row.bytes), {
        headers: {
          'Content-Type': row.mime_type,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    if (request.method === 'GET') return result(await publicProfile(env));
    if (!admin || request.method !== 'POST')
      return result({ error: '请求方法不支持。' }, 405);
    if (request.headers.get('Origin') !== url.origin)
      return result({ error: '请求来源无效。' }, 403);
    if (!request.headers.get('Content-Type')?.startsWith('multipart/form-data'))
      return result({ error: '上传格式无效。' }, 415);
    const declared = Number(request.headers.get('Content-Length'));
    if (declared > 240000) return result({ error: '上传文件过大。' }, 413);
    const reader = request.body?.getReader();
    if (!reader) return result({ error: '请求为空。' }, 400);
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 240000) {
        await reader.cancel();
        return result({ error: '上传文件过大。' }, 413);
      }
      chunks.push(value);
    }
    const payload = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      payload.set(chunk, offset);
      offset += chunk.length;
    }
    const form = await new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: payload,
    }).formData();
    const nickname = form.get('nickname');
    const bio = form.get('bio');
    const location = form.get('location');
    if (
      typeof nickname !== 'string' ||
      !nickname.trim() ||
      [...nickname.trim()].length > 40 ||
      typeof bio !== 'string' ||
      [...bio].length > 160 ||
      typeof location !== 'string' ||
      [...location].length > 80
    )
      return result(
        { error: '昵称需 1–40 字，简介最多 160 字，位置最多 80 字。' },
        400,
      );
    const removeAvatar = form.get('removeAvatar') === 'true';
    const file = form.get('avatar');
    let avatarId: string | null | undefined = removeAvatar ? null : undefined;
    const statements = [];
    if (file && typeof file !== 'string' && file.size) {
      if (file.size > 200 * 1024)
        return result({ error: '头像不能超过 200 KB。' }, 413);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let size;
      try {
        size = imageSize(bytes);
      } catch {
        return result({ error: '图片无法识别，请换一张图片。' }, 400);
      }
      const types: Record<string, string> = {
        jpg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
      };
      if (
        !size.type ||
        !types[size.type] ||
        file.type !== types[size.type] ||
        !size.width ||
        !size.height ||
        size.width > 1024 ||
        size.height > 1024 ||
        size.width < 16 ||
        size.height < 16
      )
        return result(
          { error: '仅支持 16–1024 像素的 JPEG、PNG、WebP 图片。' },
          400,
        );
      avatarId = crypto.randomUUID();
      statements.push(
        env.DB.prepare(
          'INSERT INTO avatars(id,mime_type,width,height,bytes,created_at) VALUES(?,?,?,?,?,?)',
        ).bind(
          avatarId,
          types[size.type],
          size.width,
          size.height,
          bytes,
          new Date().toISOString(),
        ),
      );
    }
    const previous = await env.DB.prepare(
      'SELECT avatar_id FROM profile WHERE id=1',
    ).first<{ avatar_id: string | null }>();
    const nextAvatar =
      avatarId === undefined ? (previous?.avatar_id ?? null) : avatarId;
    statements.push(
      env.DB.prepare(
        'INSERT INTO profile(id,nickname,bio,location,avatar_id,updated_at) VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET nickname=excluded.nickname,bio=excluded.bio,location=excluded.location,avatar_id=excluded.avatar_id,updated_at=excluded.updated_at',
      ).bind(
        nickname.trim(),
        bio,
        location,
        nextAvatar,
        new Date().toISOString(),
      ),
    );
    await env.DB.batch(statements);
    return result(await publicProfile(env));
  } catch (error) {
    console.error(
      'profile operation failed',
      error instanceof Error ? error.message : 'unknown',
    );
    return result({ error: '资料保存或读取失败，请稍后重试。' }, 503);
  }
}
