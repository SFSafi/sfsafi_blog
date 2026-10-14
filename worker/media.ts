import { requireOwner, json, type OwnerEnv } from './owner';

export interface MediaEnv extends OwnerEnv {
  TRANSCODER_URL?: string;
  TRANSCODER_TOKEN?: string;
}

export async function mediaRoute(request: Request, env: MediaEnv) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/admin/media')) return null;
  const match = url.pathname.match(
    /^\/api\/admin\/media(?:\/(health|jobs)(?:\/([a-f0-9-]{36})(?:\/(playback|poster|original))?)?)?$/,
  );
  if (!match || !match[1]) return json({ error: '接口不存在。' }, 404);
  const denied = await requireOwner(request, env);
  if (denied) return denied;
  const upload = match[1] === 'jobs' && !match[2];
  if (request.method !== (upload ? 'POST' : 'GET'))
    return json({ error: '请求方法不支持。' }, 405);
  if (upload && request.headers.get('Origin') !== url.origin)
    return json({ error: '请从本站上传。' }, 403);
  if (
    !env.TRANSCODER_URL ||
    !env.TRANSCODER_TOKEN ||
    env.TRANSCODER_TOKEN.length < 32
  )
    return json(
      { error: 'FFmpeg 服务尚未部署或配置，视频上传暂不可用。' },
      503,
    );
  let target: URL;
  try {
    target = new URL(env.TRANSCODER_URL);
    if (
      target.protocol !== 'https:' ||
      target.username ||
      target.password ||
      target.search ||
      target.hash
    )
      throw Error();
    target.pathname =
      '/' +
      match[1] +
      (match[2] ? '/' + match[2] : '') +
      (match[3] ? '/' + match[3] : '');
  } catch {
    return json({ error: '转码服务地址须为 HTTPS 地址。' }, 503);
  }
  const headers = new Headers({
    Authorization: 'Bearer ' + env.TRANSCODER_TOKEN,
  });
  if (upload) {
    const preset = url.searchParams.get('preset') || 'standard';
    if (!['high', 'standard', 'economy', 'original'].includes(preset))
      return json({ error: '压缩档位无效。' }, 400);
    const length = Number(request.headers.get('Content-Length'));
    if (
      !Number.isSafeInteger(length) ||
      length <= 0 ||
      length > 64 * 1024 * 1024
    )
      return json({ error: '请选择不超过 64 MiB 的视频。' }, 413);
    target.searchParams.set('preset', preset);
    target.searchParams.set(
      'keepOriginal',
      String(
        preset === 'original' ||
          url.searchParams.get('keepOriginal') === 'true',
      ),
    );
    headers.set('Content-Type', 'application/octet-stream');
    headers.set('Content-Length', String(length));
  } else if (request.headers.has('Range')) {
    headers.set('Range', request.headers.get('Range')!);
  }
  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      body: upload ? request.body : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(upload ? 120000 : 20000),
    });
    if (
      response.status === 401 ||
      response.status >= 500 ||
      (response.status >= 300 && response.status < 400)
    )
      return json({ error: '转码服务连接或认证失败，请检查服务配置。' }, 502);
    const outgoing = new Headers({
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    for (const name of [
      'Content-Type',
      'Content-Length',
      'Content-Range',
      'Accept-Ranges',
      'Content-Disposition',
    ]) {
      const value = response.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      headers: outgoing,
    });
  } catch {
    return json(
      { error: '转码服务暂不可用；请稍后重试，未自动上传原素材。' },
      502,
    );
  }
}
