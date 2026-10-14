import { deliverUpdates } from '../worker/notifications';
import type { D1Database } from '@cloudflare/workers-types';
import { createHmac } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { Miniflare, createFetchMock } from 'miniflare';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
const base = 'https://space.test';
async function fixture() {
  const pair = await generateKeyPair('RS256', { extractable: true }),
    jwk = await exportJWK(pair.publicKey);
  jwk.kid = 'writing-test';
  jwk.alg = 'RS256';
  const mock = createFetchMock();
  mock.disableNetConnect();
  mock
    .get('https://writer-test.cloudflareaccess.com')
    .intercept({ path: '/cdn-cgi/access/certs' })
    .reply(200, JSON.stringify({ keys: [jwk] }))
    .persist();
  const sign = (email: string) =>
    new SignJWT({ email })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
      .setIssuer('https://writer-test.cloudflareaccess.com')
      .setAudience('writing-aud')
      .setSubject(email)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(pair.privateKey);
  const token = await sign('owner@example.com'),
    other = await sign('other@example.com');
  const dir = mkdtempSync(join(tmpdir(), 'sfsafi-writing-'));
  const assets = async (request: any) => {
    let path = new URL(request.url).pathname;
    if (path.endsWith('/')) path += 'index.html';
    const root = resolve('dist'),
      file = resolve(root, '.' + path);
    if (!file.startsWith(root + '/') || !existsSync(file))
      return new Response('Not found', { status: 404 });
    const types: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.mp4': 'video/mp4',
      '.woff2': 'font/woff2',
    };
    return new Response(readFileSync(file), {
      headers: {
        'Content-Type': types[extname(file)] || 'application/octet-stream',
      },
    });
  };
  const options = {
    script: readFileSync('/tmp/sfsafi-worker-bundle/index.js', 'utf8'),
    modules: true,
    compatibilityDate: '2026-06-01',
    d1Databases: { DB: 'writing' },
    d1Persist: dir,
    fetchMock: mock,
    bindings: {
      ACCESS_TEAM_DOMAIN: 'writer-test.cloudflareaccess.com',
      ACCESS_AUD: 'writing-aud',
      OWNER_EMAIL: 'owner@example.com',
    },
    serviceBindings: { ASSETS: assets },
  };
  let mf = new Miniflare(options);
  const dispatch = (
    path: string,
    body?: unknown,
    auth: string | false = token,
    extra: Record<string, string> = {},
  ) =>
    mf.dispatchFetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(auth ? { 'Cf-Access-Jwt-Assertion': auth } : {}),
        ...(body === undefined
          ? {}
          : { Origin: base, 'Content-Type': 'application/json' }),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return {
    get mf() {
      return mf;
    },
    dispatch,
    token,
    other,
    options,
    async restart() {
      await mf.dispose();
      mf = new Miniflare(options);
    },
    async close() {
      await mf.dispose();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test('D1 写文：唯一站主、草稿隔离、冲突、即时页面/搜索、撤回和持久发布事件', async () => {
  const f = await fixture();
  try {
    expect(
      (await f.dispatch('/api/admin/posts', undefined, false)).status,
    ).toBe(401);
    expect(
      (await f.dispatch('/api/admin/posts', undefined, f.other)).status,
    ).toBe(403);
    expect(
      (await f.dispatch('/api/admin/profile', undefined, f.other)).status,
    ).toBe(403);
    await f.dispatch('/api/admin/locations', {
      postId: 'hello-space',
      label: '更改城市',
    });
    const sample = (await (
      await f.dispatch('/api/admin/posts/hello-space')
    ).json()) as any;
    expect(sample.location.label).toBe('更改城市');
    const changed = await f.dispatch('/api/admin/posts', {
      ...sample,
      title: sample.title || '',
      excerpt: sample.excerpt || '',
      location: '另一城市',
    });
    expect(changed.status).toBe(200);
    const places = (await (
      await f.dispatch('/api/post-locations', undefined, false)
    ).json()) as any[];
    expect(places.find((p) => p.postId === 'hello-space').label).toBe(
      '另一城市',
    );
    const id = 'post-' + crypto.randomUUID();
    const data = {
      id,
      revision: 0,
      title: '真实测试文章',
      body: '# Hello\n\n独立内容 WRITING_SENTINEL\n\n<script>window.hacked=1</script>\n\n[危险链接](javascript:alert(1))',
      kind: 'article',
      excerpt: '独立摘要',
      tags: ['新的标签'],
      location: '手动城市',
      pinned: false,
    };
    const created = await f.dispatch('/api/admin/posts', data);
    expect(created.status).toBe(200);
    const draft = (await created.json()) as any;
    expect(draft.status).toBe('draft');
    expect((await f.dispatch(`/posts/${id}/`, undefined, false)).status).toBe(
      404,
    );
    const hidden = await (
      await f.dispatch('/api/search', { query: 'WRITING_SENTINEL' }, false)
    ).json();
    expect(JSON.stringify(hidden)).not.toContain(id);
    expect((await f.dispatch('/api/admin/posts', data)).status).toBe(409);
    const published = await f.dispatch('/api/admin/posts/' + id + '/publish', {
      revision: 1,
    });
    expect(published.status).toBe(200);
    const page = await (
      await f.dispatch('/posts/' + id + '/', undefined, false)
    ).text();
    expect(page).toContain('WRITING_SENTINEL');
    expect(page).not.toContain('<script>window.hacked');
    expect(page).not.toContain('href="javascript:');
    expect(page).toContain('data-post-revision="2"');
    expect(await (await f.dispatch('/', undefined, false)).text()).toContain(
      id,
    );
    const search = (await (
      await f.dispatch('/api/search', { query: 'WRITING_SENTINEL' }, false)
    ).json()) as any;
    expect(search.sources[0].id).toBe(id);
    expect(
      (
        await f.dispatch(
          '/tags/' + encodeURIComponent('新的标签') + '/',
          undefined,
          false,
        )
      ).status,
    ).toBe(200);
    const db = await f.mf.getD1Database('DB');
    expect(
      (
        (await db
          .prepare(
            'SELECT count(*) AS count FROM publication_outbox WHERE post_id=?',
          )
          .bind(id)
          .first()) as any
      ).count,
    ).toBe(1);
    await f.restart();
    expect((await f.dispatch('/api/admin/posts/' + id)).status).toBe(200);
    expect(
      (
        await f.dispatch('/api/admin/posts/' + id + '/withdraw', {
          revision: 2,
        })
      ).status,
    ).toBe(200);
    const gone = await f.dispatch('/posts/' + id + '/', undefined, false);
    expect(gone.status).toBe(404);
    const alias = await f.dispatch(
      '/posts/' + id + '/index.html',
      undefined,
      false,
    );
    expect([308, 404]).toContain(alias.status);
    expect(await alias.text()).not.toContain('WRITING_SENTINEL');
    expect(await gone.text()).not.toContain('WRITING_SENTINEL');
    expect(
      (await f.dispatch('/api/admin/posts/' + id + '/publish', { revision: 3 }))
        .status,
    ).toBe(200);
    const db2 = await f.mf.getD1Database('DB');
    expect(
      (
        (await db2
          .prepare(
            'SELECT count(*) AS count FROM publication_outbox WHERE post_id=?',
          )
          .bind(id)
          .first()) as any
      ).count,
    ).toBe(1);
  } finally {
    await f.close();
  }
});
test('真实本地 D1 浏览器写文、预览、发布及评论审核；读者不能写文', async ({
  browser,
}) => {
  const f = await fixture();
  const context = await browser.newContext();
  async function routeContext(target: any, owner: boolean) {
    await target.route(base + '/**', async (route: any) => {
      const r = route.request(),
        headers = { ...r.headers() };
      if (owner && new URL(r.url()).pathname.startsWith('/api/admin/'))
        headers['Cf-Access-Jwt-Assertion'] = f.token;
      const response = await f.mf.dispatchFetch(r.url(), {
        method: r.method(),
        headers,
        body: r.postDataBuffer() || undefined,
      });
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()),
      });
    });
  }
  try {
    await routeContext(context, true);
    const page = await context.newPage();
    await page.goto(base + '/admin/write/');
    await expect(page.getByLabel('正文（Markdown）')).toBeEnabled();
    await page
      .getByRole('combobox', { name: '类型', exact: true })
      .selectOption('article');
    await page.getByLabel('标题', { exact: true }).fill('浏览器写文测试');
    await page
      .getByLabel('正文（Markdown）')
      .fill('## 安全的标题\n\n浏览器创建文章。');
    await page.getByLabel('标签（逗号分隔，最多 8 个）').fill('浏览器测试');
    await page.getByLabel('手动地点').fill('我的地点');
    await page.getByRole('button', { name: '预览', exact: true }).click();
    await expect(page.locator('#editor-preview-panel h2')).toHaveText(
      '安全的标题',
    );
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.locator('#editor-status')).toHaveText('草稿已保存。');
    const id = new URL(page.url()).searchParams.get('id')!;
    await page.reload();
    await expect(page.getByLabel('标题', { exact: true })).toHaveValue(
      '浏览器写文测试',
    );
    await page.getByRole('button', { name: '发布', exact: true }).click();
    await expect(page.locator('#editor-status')).toHaveText(
      '发布成功，该版本已上线。',
    );
    const visitor = await browser.newContext();
    await routeContext(visitor, false);
    const read = await visitor.newPage();
    await read.goto(base + '/posts/' + id + '/');
    await expect(read.locator('.post-title')).toHaveText('浏览器写文测试');
    await expect(read.locator('[data-vote="1"]')).toBeEnabled();
    await read.getByLabel('昵称', { exact: true }).fill('读者');
    await read
      .getByLabel('评论', { exact: true })
      .fill('<img src=x onerror=alert(1)> hello');
    await read.getByRole('button', { name: '提交评论', exact: true }).click();
    await expect(read.locator('[data-comments-status]')).toHaveText(
      '评论已提交，审核通过后会显示。',
    );
    expect(
      await read.locator('[data-comments-list]').textContent(),
    ).not.toContain('onerror');
    for (const width of [360, 390, 768, 1440]) {
      await read.setViewportSize({ width, height: 900 });
      expect(
        await read.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.goto(base + '/admin/comments/');
    await expect(page.locator('#moderation-list .comment-item')).toHaveCount(1);
    await page.getByRole('button', { name: '通过', exact: true }).click();
    await expect(page.locator('#moderation-status')).toHaveText(
      '评论状态已更新。',
    );
    await page.locator('#comments-filter').selectOption('approved');
    await page.getByLabel('站主回复 读者').fill('感谢阅读。');
    await page.getByRole('button', { name: '站主回复', exact: true }).click();
    await expect(page.locator('#moderation-status')).toHaveText(
      '站主回复已发布。',
    );
    await read.reload();
    await expect(read.locator('[data-comments-list]')).toContainText(
      '<img src=x onerror=alert(1)> hello',
    );
    await expect(read.locator('[data-comments-list] img')).toHaveCount(0);
    await expect(read.locator('[data-comments-list]')).toContainText(
      'SFSafi · 站主',
    );
    await expect(read.locator('[data-comments-list]')).toContainText(
      '感谢阅读。',
    );
    await read.goto(base + '/admin/write/');
    await expect(read.locator('#editor-status')).toContainText('登录');
    await expect(read.getByLabel('正文（Markdown）')).toBeDisabled();
    await visitor.close();
  } finally {
    await context.close().catch(() => {});
    await f.close();
  }
});
test('评论 API：幂等提交、审核/父评论隔离、限流及跨站拒绝', async () => {
  const f = await fixture();
  try {
    const session = await f.dispatch(
      '/api/engagement?ids=hello-space',
      undefined,
      false,
    );
    const cookie = session.headers.get('set-cookie')!.split(';')[0];
    const body = {
      postId: 'hello-space',
      nickname: '访客',
      body: '测试评论',
      clientId: crypto.randomUUID(),
      parentId: null,
    };
    const extra = { Cookie: cookie, 'CF-Connecting-IP': '1.2.3.4' };
    expect((await f.dispatch('/api/comments', body, false, extra)).status).toBe(
      200,
    );
    expect((await f.dispatch('/api/comments', body, false, extra)).status).toBe(
      200,
    );
    expect(
      (
        (await (
          await f.dispatch('/api/comments?postId=hello-space', undefined, false)
        ).json()) as any
      ).items,
    ).toHaveLength(0);
    expect(
      (
        await f.dispatch(
          '/api/admin/comments',
          { id: body.clientId, revision: 1, status: 'approved' },
          f.other,
        )
      ).status,
    ).toBe(403);
    await f.dispatch('/api/admin/comments', {
      id: body.clientId,
      revision: 1,
      status: 'approved',
    });
    expect(
      (
        (await (
          await f.dispatch('/api/comments?postId=hello-space', undefined, false)
        ).json()) as any
      ).items,
    ).toHaveLength(1);
    const reply = {
      ...body,
      clientId: crypto.randomUUID(),
      parentId: body.clientId,
    };
    expect(
      (await f.dispatch('/api/comments', reply, false, extra)).status,
    ).toBe(200);
    await f.dispatch('/api/admin/comments', {
      id: reply.clientId,
      revision: 1,
      status: 'approved',
    });
    await f.dispatch('/api/admin/comments', {
      id: body.clientId,
      revision: 2,
      status: 'hidden',
    });
    expect(
      (
        (await (
          await f.dispatch('/api/comments?postId=hello-space', undefined, false)
        ).json()) as any
      ).items,
    ).toHaveLength(0);
    expect(
      (
        await f.dispatch(
          '/api/comments',
          { ...body, clientId: crypto.randomUUID() },
          false,
          extra,
        )
      ).status,
    ).toBe(429);
    expect(
      (
        await f.dispatch(
          '/api/comments',
          { ...body, clientId: crypto.randomUUID() },
          false,
          { ...extra, Origin: 'https://evil.test' },
        )
      ).status,
    ).toBe(403);
    expect(
      (await f.dispatch('/api/comments?postId=private-draft', undefined, false))
        .status,
    ).toBe(404);
  } finally {
    await f.close();
  }
});

test('发布事件：真实 D1 + 公开版本确认 + HMAC Bot 接收确认，错误回执保留重试', async () => {
  const f = await fixture();
  const originalFetch = globalThis.fetch;
  const secret = 'notification-test-secret-more-than-32-chars';
  let calls = 0,
    badAck = false;
  try {
    const publish = async (title: string) => {
      const id = 'post-' + crypto.randomUUID();
      await f.dispatch('/api/admin/posts', {
        id,
        revision: 0,
        title,
        body: '真实公开版本',
        kind: 'article',
        excerpt: '摘要',
        tags: [],
        location: '',
        pinned: false,
      });
      await f.dispatch('/api/admin/posts/' + id + '/publish', { revision: 1 });
      return id;
    };
    const id = await publish('第一条更新');
    const db = await f.mf.getD1Database('DB');
    globalThis.fetch = async (input, init) => {
      const url = new URL(
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (url.origin === base) {
        const response = await f.mf.dispatchFetch(url.href);
        return new Response(await response.arrayBuffer(), {
          status: response.status,
          headers: Object.fromEntries(response.headers),
        });
      }
      if (url.href === 'https://bot.test/site-updates') {
        calls++;
        const headers = new Headers(init?.headers),
          body = String(init?.body);
        expect(headers.get('X-Space-Signature')).toBe(
          createHmac('sha256', secret)
            .update(headers.get('X-Space-Timestamp') + '.' + body)
            .digest('hex'),
        );
        const event = JSON.parse(body);
        expect(event.revision).toBe(2);
        expect(event.url).toBe(base + '/posts/' + event.postId + '/');
        return Response.json({
          accepted: true,
          eventId: badAck ? 'wrong-id' : event.eventId,
        });
      }
      return originalFetch(input, init);
    };
    const env = {
      DB: db as unknown as D1Database,
      SITE_URL: base,
      QQ_BOT_WEBHOOK_URL: 'https://bot.test/site-updates',
      QQ_SITE_SECRET: secret,
    };
    expect(await deliverUpdates(env)).toEqual({ enabled: true, accepted: 1 });
    expect(calls).toBe(1);
    expect(
      (
        (await db
          .prepare('SELECT state FROM publication_outbox WHERE post_id=?')
          .bind(id)
          .first()) as any
      ).state,
    ).toBe('accepted');
    expect(await deliverUpdates(env)).toEqual({ enabled: true, accepted: 0 });
    expect(calls).toBe(1);
    badAck = true;
    const second = await publish('第二条更新');
    expect(await deliverUpdates(env)).toEqual({ enabled: true, accepted: 0 });
    const failed = (await db
      .prepare('SELECT state,attempts FROM publication_outbox WHERE post_id=?')
      .bind(second)
      .first()) as any;
    expect(failed.state).toBe('pending');
    expect(failed.attempts).toBe(1);
    expect(
      (
        await f.dispatch(
          '/api/admin/qq/retry',
          { source: 'site', id: 'first-published:' + second, state: 'failed' },
          f.other,
        )
      ).status,
    ).toBe(403);
  } finally {
    globalThis.fetch = originalFetch;
    await f.close();
  }
});
