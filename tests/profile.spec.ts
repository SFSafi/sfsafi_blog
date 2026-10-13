import { test, expect } from '@playwright/test';
import { Miniflare, createFetchMock } from 'miniflare';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('本地 Workerd + D1：Access 签名验证、头像昵称持久化和重启恢复', async ({
  page,
}) => {
  const { privateKey, publicKey } = await generateKeyPair('RS256', {
    extractable: true,
  });
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'local-test-key';
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  const mock = createFetchMock();
  mock.disableNetConnect();
  mock
    .get('https://sfsafi-test.cloudflareaccess.com')
    .intercept({ path: '/cdn-cgi/access/certs' })
    .reply(200, JSON.stringify({ keys: [jwk] }), {
      headers: { 'Content-Type': 'application/json' },
    })
    .persist();
  const dir = mkdtempSync(join(tmpdir(), 'sfsafi-profile-'));
  const options = {
    script: readFileSync('/tmp/sfsafi-worker-bundle/index.js', 'utf8'),
    modules: true,
    compatibilityDate: '2026-06-01',
    d1Databases: { DB: 'profile-test' },
    d1Persist: dir,
    bindings: {
      ACCESS_TEAM_DOMAIN: 'sfsafi-test.cloudflareaccess.com',
      ACCESS_AUD: 'profile-test-audience',
    },
    fetchMock: mock,
  };
  let mf = new Miniflare(options);
  async function dispatch(url: string, init: RequestInit = {}) {
    const request = new Request(url, init);
    return mf.dispatchFetch(url, {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      body: request.method === 'GET' ? undefined : await request.arrayBuffer(),
    });
  }

  try {
    expect((await dispatch('https://example.com/api/profile')).status).toBe(
      200,
    );
    const sign = (aud = 'profile-test-audience', exp = '1h') =>
      new SignJWT({ email: 'owner@example.com' })
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
        .setIssuer('https://sfsafi-test.cloudflareaccess.com')
        .setAudience(aud)
        .setSubject('owner')
        .setIssuedAt()
        .setExpirationTime(exp)
        .sign(privateKey);
    const token = await sign();
    const url = 'https://example.com/api/admin/profile';
    const headers = {
      'Cf-Access-Jwt-Assertion': token,
      Origin: 'https://example.com',
    };
    expect((await dispatch(url)).status).toBe(401);
    expect(
      (
        await dispatch(url, {
          headers: {
            ...headers,
            'Cf-Access-Jwt-Assertion': await sign('wrong-audience'),
          },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await dispatch(url, {
          headers: {
            ...headers,
            'Cf-Access-Jwt-Assertion': await sign(
              'profile-test-audience',
              '-1h',
            ),
          },
        })
      ).status,
    ).toBe(403);
    await page.goto('http://127.0.0.1:4321/');
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      c.getContext('2d')!.fillRect(0, 0, 64, 64);
      return c.toDataURL('image/png').split(',')[1];
    });
    const form = new FormData();
    form.set('nickname', '自己的昵称');
    form.set('bio', '个人简介');
    form.set('location', '手动填写的位置');
    form.set(
      'avatar',
      new Blob([Buffer.from(png, 'base64')], { type: 'image/png' }),
      'avatar.png',
    );
    const response = await dispatch(url, {
      method: 'POST',
      headers,
      body: form,
    });
    expect(response.status).toBe(200);
    const saved = (await response.json()) as {
      avatarUrl: string;
      name: string;
    };
    expect(saved.name).toBe('自己的昵称');
    const avatar = await dispatch('https://example.com' + saved.avatarUrl);
    expect(avatar.status).toBe(200);
    expect(avatar.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await avatar.arrayBuffer()).length).toBeGreaterThan(
      100,
    );
    const forged = new FormData();
    for (const [key, value] of [
      ['nickname', '篡改'],
      ['bio', ''],
      ['location', ''],
    ])
      forged.set(key, value);
    forged.set(
      'avatar',
      new Blob(['<svg onload="alert(1)"/>'], { type: 'image/svg+xml' }),
      'avatar.svg',
    );
    expect(
      (await dispatch(url, { method: 'POST', headers, body: forged })).status,
    ).toBe(400);
    expect(
      (
        await dispatch(url, {
          method: 'POST',
          headers: { ...headers, Origin: 'https://evil.example' },
          body: new FormData(),
        })
      ).status,
    ).toBe(403);
    // Browser requests are forwarded to the real local worker, with a locally signed
    // Access assertion standing in for the Cloudflare gateway (not a live Access service).
    await page.route('**/api/**', async (route) => {
      const req = route.request();
      const parsed = new URL(req.url());
      const body = req.postDataBuffer();
      const response = await dispatch(
        'https://example.com' + parsed.pathname + parsed.search,
        {
          method: req.method(),
          headers: {
            ...req.headers(),
            'cf-access-jwt-assertion': token,
            origin: 'https://example.com',
          },
          ...(body ? { body: new Uint8Array(body) } : {}),
        },
      );
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()),
      });
    });
    await page.goto('http://127.0.0.1:4321/admin/profile/');
    await expect(
      page.getByRole('textbox', { name: '昵称', exact: true }),
    ).toBeEnabled();
    await page
      .getByRole('textbox', { name: '昵称', exact: true })
      .fill('浏览器修改昵称');
    await page.locator('input[type=file]').setInputFiles({
      name: 'avatar.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    });
    await expect(page.locator('#profile-status')).toContainText('头像已准备好');
    await page.getByRole('button', { name: '保存资料', exact: true }).click();
    await expect(page.locator('#profile-status')).toContainText('已保存');
    await expect(page.locator('[data-profile-name]').first()).toHaveText(
      '浏览器修改昵称',
    );
    await page
      .getByRole('textbox', { name: '昵称', exact: true })
      .fill('W'.repeat(40));
    await page.getByRole('button', { name: '保存资料', exact: true }).click();
    await expect(page.locator('#profile-status')).toContainText('已保存');
    await page.goto('http://127.0.0.1:4321/posts/afternoon-walk/');
    await expect(page.locator('[data-profile-name]').first()).toHaveText(
      'W'.repeat(40),
    );
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 960 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.goto('http://127.0.0.1:4321/admin/locations/');
    await expect(page.locator('select[name=postId]')).toBeEnabled();
    await page.locator('select[name=postId]').selectOption('afternoon-walk');
    await page
      .getByRole('textbox', { name: '地点', exact: true })
      .fill('上海 · 手动地点');
    await page.getByRole('button', { name: '保存地点', exact: true }).click();
    await expect(page.locator('#location-status')).toContainText('地点已保存');
    await page.goto('http://127.0.0.1:4321/posts/afternoon-walk/');
    await expect(page.locator('[data-location-link]')).toHaveText(
      '⌖ 上海 · 手动地点',
    );
    const beforeRestart = (await (
      await dispatch('https://example.com/api/profile')
    ).json()) as { name: string; avatarUrl: string };
    const initialStats = await dispatch(
      'https://example.com/api/engagement?ids=hello-space',
    );
    const visitorCookie = initialStats.headers.get('Set-Cookie')!.split(';')[0];
    const visitorHeaders = {
      Cookie: visitorCookie,
      Origin: 'https://example.com',
      'Content-Type': 'application/json',
    };
    expect(
      (
        await dispatch('https://example.com/api/engagement/hello-space/view', {
          method: 'POST',
          headers: visitorHeaders,
          body: '{}',
        })
      ).status,
    ).toBe(200);
    const voted = await dispatch(
      'https://example.com/api/engagement/hello-space/vote',
      { method: 'POST', headers: visitorHeaders, body: '{"vote":1}' },
    );
    expect(voted.status).toBe(200);
    await mf.dispose();
    mf = new Miniflare(options);
    const restored = (await (
      await dispatch('https://example.com/api/profile')
    ).json()) as { name: string; location: string; avatarUrl: string };
    expect(restored.name).toBe(beforeRestart.name);
    expect(restored.location).toBe('手动填写的位置');
    expect(restored.avatarUrl).toBe(beforeRestart.avatarUrl);
    const places = (await (
      await dispatch(
        'https://example.com/api/post-locations?ids=afternoon-walk',
      )
    ).json()) as { label: string }[];
    expect(places[0].label).toBe('上海 · 手动地点');
    const restoredStats = (await (
      await dispatch('https://example.com/api/engagement?ids=hello-space', {
        headers: { Cookie: visitorCookie },
      })
    ).json()) as { views: number; likes: number; myVote: number }[];
    expect(restoredStats[0]).toMatchObject({ views: 1, likes: 1, myVote: 1 });
  } finally {
    await mf.dispose();
    await mock.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
