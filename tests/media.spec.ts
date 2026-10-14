import { test, expect } from '@playwright/test';
import { Miniflare } from 'miniflare';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { readFileSync } from 'node:fs';

test('视频代理：站主签名、同源、大小、服务密钥与私有 Range', async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = 'media-key';
  const secret = 'fixture-only-' + 'x'.repeat(32);
  const calls: string[] = [];
  const outbound = async (request: any) => {
    const url = new URL(request.url);
    if (url.hostname === 'media-test.cloudflareaccess.com')
      return new Response(JSON.stringify({ keys: [jwk] }));
    expect(url.hostname).toBe('transcode.test');
    expect(request.headers.get('Authorization')).toBe('Bearer ' + secret);
    calls.push(url.pathname);
    if (url.pathname === '/health')
      return new Response(JSON.stringify({ ok: true }));
    if (request.method === 'POST') {
      expect(url.search).toBe('?preset=standard&keepOriginal=false');
      expect(await request.text()).toBe('fixture');
      expect(request.headers.get('Content-Length')).toBe('7');
      return new Response(
        JSON.stringify({
          id: '11111111-1111-4111-8111-111111111111',
          status: 'queued',
        }),
        { status: 202 },
      );
    }
    expect(request.headers.get('Range')).toBe('bytes=0-2');
    return new Response('abc', {
      status: 206,
      headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-2/99' },
    });
  };
  const sign = (email: string) =>
    new SignJWT({ email })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
      .setIssuer('https://media-test.cloudflareaccess.com')
      .setAudience('media-aud')
      .setSubject(email)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(pair.privateKey);
  const token = await sign('owner@example.com');
  const mf = new Miniflare({
    script: readFileSync('/tmp/sfsafi-worker-bundle/index.js', 'utf8'),
    modules: true,
    compatibilityDate: '2026-06-01',
    outboundService: outbound,
    bindings: {
      ACCESS_TEAM_DOMAIN: 'media-test.cloudflareaccess.com',
      ACCESS_AUD: 'media-aud',
      OWNER_EMAIL: 'owner@example.com',
      TRANSCODER_URL: 'https://transcode.test',
      TRANSCODER_TOKEN: secret,
    },
  });
  const base = 'https://blog.test/api/admin/media';
  const auth = { 'Cf-Access-Jwt-Assertion': token };
  try {
    expect((await mf.dispatchFetch(base + '/health')).status).toBe(401);
    expect(
      (
        await mf.dispatchFetch(base + '/health', {
          headers: {
            'Cf-Access-Jwt-Assertion': await sign('other@example.com'),
          },
        })
      ).status,
    ).toBe(403);
    expect(
      (await mf.dispatchFetch(base + '/health', { headers: auth })).status,
    ).toBe(200);
    expect(
      (
        await mf.dispatchFetch(base + '/jobs', {
          method: 'POST',
          body: 'fixture',
          headers: auth,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await mf.dispatchFetch(base + '/jobs?preset=bogus', {
          method: 'POST',
          body: 'fixture',
          headers: { ...auth, Origin: 'https://blog.test' },
        })
      ).status,
    ).toBe(400);
    const response = await mf.dispatchFetch(base + '/jobs', {
      method: 'POST',
      body: 'fixture',
      headers: { ...auth, Origin: 'https://blog.test', 'Content-Length': '7' },
    });
    expect(response.status).toBe(202);
    const range = await mf.dispatchFetch(
      base + '/jobs/11111111-1111-4111-8111-111111111111/playback',
      { headers: { ...auth, Range: 'bytes=0-2' } },
    );
    expect(range.status).toBe(206);
    expect(await range.text()).toBe('abc');
    expect(range.headers.get('Content-Range')).toBe('bytes 0-2/99');
    expect(range.headers.get('Cache-Control')).toContain('private');
    expect(calls).toHaveLength(3);
  } finally {
    await mf.dispose();
  }
});

test('转码页面：未配置锁定、默认档位、自动上传、结果与刷新恢复', async ({
  page,
}) => {
  await page.route('**/api/admin/media/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/health'))
      return route.fulfill({
        status: 503,
        json: { error: 'FFmpeg 服务尚未部署或配置，视频上传暂不可用。' },
      });
    return route.fulfill({ status: 404 });
  });
  await page.goto('/admin/media/');
  await expect(page.locator('#media-status')).toContainText('尚未部署');
  await expect(page.locator('input[type=file]')).toBeDisabled();
  await page.unrouteAll({ behavior: 'wait' });
  let uploaded = false;
  await page.route('**/api/admin/media/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/health'))
      return route.fulfill({ json: { ok: true } });
    if (route.request().method() === 'POST') {
      expect(url.searchParams.get('preset')).toBe('standard');
      expect(url.searchParams.get('keepOriginal')).toBe('false');
      expect(route.request().postDataBuffer()?.toString()).toBe(
        'video fixture',
      );
      uploaded = true;
      return route.fulfill({
        status: 202,
        json: { id: '11111111-1111-4111-8111-111111111111' },
      });
    }
    if (url.pathname.endsWith('/playback') || url.pathname.endsWith('/poster'))
      return route.fulfill({ status: 404 });
    return route.fulfill({
      json: {
        status: 'ready',
        result: {
          input: { bytes: 200000 },
          output: { bytes: 100000, width: 1280, height: 720, duration: 10 },
          savedRatio: 0.5,
          storedBytes: 101000,
          originalRetained: false,
        },
      },
    });
  });
  await page.reload();
  await expect(page.locator('input[type=file]')).toBeEnabled();
  await expect(page.locator('input[type=checkbox]')).not.toBeChecked();
  await page.locator('input[type=file]').setInputFiles({
    name: 'test.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('video fixture'),
  });
  await expect(page.locator('#media-status')).toContainText('处理完成');
  expect(uploaded).toBe(true);
  await expect(page.locator('video')).toHaveAttribute('src', /\/playback$/);
  await page.reload();
  await expect(page.locator('#media-status')).toContainText('处理完成');
  await page.unrouteAll({ behavior: 'wait' });
});
