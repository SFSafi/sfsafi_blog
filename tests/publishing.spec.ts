import { deliverUpdates } from '../worker/notifications';
import type { D1Database } from '@cloudflare/workers-types';
import { createHmac } from 'node:crypto';
import { test, expect, type BrowserContext } from '@playwright/test';
import { Miniflare, createFetchMock } from 'miniflare';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
const base = 'https://space.test';
async function fixture(enableMail = false) {
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
  const mail = { messages: [] as any[], mode: 'ok' };
  const outboundService = async (request: any) => {
    if (new URL(request.url).hostname === 'writer-test.cloudflareaccess.com')
      return Response.json({ keys: [jwk] });
    expect(request.url).toBe('https://api.resend.com/emails');
    expect(request.headers.get('Authorization')).toBe(
      'Bearer fixture-resend-key',
    );
    const data = await request.json();
    mail.messages.push({
      ...data,
      key: request.headers.get('Idempotency-Key'),
    });
    if (mail.mode === 'failure')
      return Response.json({ error: 'fixture' }, { status: 503 });
    return Response.json(
      mail.mode === 'missing' ? {} : { id: 'mail-' + mail.messages.length },
    );
  };
  const options = {
    script: readFileSync('/tmp/sfsafi-worker-bundle/index.js', 'utf8'),
    modules: true,
    compatibilityDate: '2026-06-01',
    d1Databases: { DB: 'writing' },
    d1Persist: dir,
    ...(enableMail ? { outboundService } : { fetchMock: mock }),
    bindings: {
      ACCESS_TEAM_DOMAIN: 'writer-test.cloudflareaccess.com',
      ACCESS_AUD: 'writing-aud',
      OWNER_EMAIL: 'owner@example.com',
      ...(enableMail
        ? {
            RESEND_API_KEY: 'fixture-resend-key',
            EMAIL_FROM: 'notify@space.test',
            SITE_URL: base,
            EMAIL_TOKEN_SECRET: 'fixture-only-' + 'x'.repeat(40),
          }
        : {}),
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
    mail,
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
async function routeFixture(
  context: BrowserContext,
  f: Awaited<ReturnType<typeof fixture>>,
  auth = true,
) {
  await context.route(base + '/**', async (route) => {
    const request = route.request();
    const response = await f.mf.dispatchFetch(request.url(), {
      method: request.method(),
      headers: {
        ...request.headers(),
        origin: base,
        ...(auth ? { 'cf-access-jwt-assertion': f.token } : {}),
      },
      body: request.postDataBuffer() || undefined,
    });
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
}
test('管理重构：已发布修改、回收站/恢复、种子不复活与唯一站主权限', async () => {
  const f = await fixture();
  try {
    const id = 'post-' + crypto.randomUUID();
    const body = {
      id,
      revision: 0,
      title: '可以修改的文章',
      kind: 'article',
      body: '管理重构测试',
      excerpt: '',
      tags: ['重构'],
      location: '',
      pinned: false,
    };
    expect((await f.dispatch('/api/admin/posts', body)).status).toBe(200);
    const published = (await (
      await f.dispatch('/api/admin/posts/' + id + '/publish', { revision: 1 })
    ).json()) as any;
    const edited = (await (
      await f.dispatch('/api/admin/posts', {
        ...body,
        revision: 2,
        title: '修改后标题',
        body: '修改后正文',
      })
    ).json()) as any;
    expect(edited.status).toBe('published');
    expect(edited.firstPublishedAt).toBe(published.firstPublishedAt);
    expect(
      await (await f.dispatch('/posts/' + id + '/', undefined, false)).text(),
    ).toContain('修改后正文');
    expect(
      (
        await f.dispatch(
          '/api/admin/posts/' + id + '/delete',
          { revision: 3, confirm: true },
          f.other,
        )
      ).status,
    ).toBe(403);
    expect(
      (await f.dispatch('/api/admin/posts/' + id + '/delete', { revision: 3 }))
        .status,
    ).toBe(400);
    const removed = (await (
      await f.dispatch('/api/admin/posts/' + id + '/delete', {
        revision: 3,
        confirm: true,
      })
    ).json()) as any;
    expect(removed.deletedAt).toBeTruthy();
    expect(
      (await f.dispatch('/posts/' + id + '/', undefined, false)).status,
    ).toBe(404);
    expect(
      JSON.stringify(
        await (
          await f.dispatch('/api/search', { query: '修改后正文' }, false)
        ).json(),
      ),
    ).not.toContain(id);
    expect(
      (await f.dispatch('/api/admin/posts/' + id + '/publish', { revision: 4 }))
        .status,
    ).toBe(409);
    expect(
      (
        (await (
          await f.dispatch('/api/admin/posts?status=trash')
        ).json()) as any
      ).items[0].id,
    ).toBe(id);
    await f.restart();
    expect(
      (await f.dispatch('/posts/' + id + '/', undefined, false)).status,
    ).toBe(404);
    const restored = (await (
      await f.dispatch('/api/admin/posts/' + id + '/restore', { revision: 4 })
    ).json()) as any;
    expect(restored.status).toBe('draft');
    expect(restored.deletedAt).toBeUndefined();
    expect(
      (await f.dispatch('/posts/' + id + '/', undefined, false)).status,
    ).toBe(404);
    expect(
      (await f.dispatch('/api/admin/posts/' + id + '/publish', { revision: 5 }))
        .status,
    ).toBe(200);
    const db = await f.mf.getD1Database('DB');
    expect(
      (
        (await db
          .prepare(
            'SELECT COUNT(*) AS count FROM publication_outbox WHERE post_id=?',
          )
          .bind(id)
          .first()) as any
      ).count,
    ).toBe(1);
    const sample = (await (
      await f.dispatch('/api/admin/posts/hello-space')
    ).json()) as any;
    await f.dispatch('/api/admin/posts/hello-space/delete', {
      revision: sample.revision,
      confirm: true,
    });
    await f.restart();
    expect(
      (await f.dispatch('/posts/hello-space/', undefined, false)).status,
    ).toBe(404);
  } finally {
    await f.close();
  }
});
test('站点文案：私有写权限、即时静态/动态页面、安全文字与内容隔离', async () => {
  const f = await fixture();
  try {
    expect(
      (await f.dispatch('/api/admin/site-copy', undefined, false)).status,
    ).toBe(401);
    const current = (await (
      await f.dispatch('/api/admin/site-copy')
    ).json()) as any;
    const key = (text: string) => {
      const found = current.catalog.find((e: any) => e.text === text);
      expect(found, text).toBeTruthy();
      return found.id;
    };
    expect(current.catalog.some((e: any) => /^\{\d+\}$/.test(e.text))).toBe(
      false,
    );
    const overrides = {
      [key('生活里的小事，也值得被记住。')]: '改过的顶部介绍',
      [key('很高兴，你路过这里。')]: '<script>window.copyInjected=1</script>',
      [key('慢慢写，慢慢生活。')]: '新的首页介绍',
      [key('管理概览')]: '仅后台的导航文案',
      [key('搜索中…')]: '正在认真找…',
    };
    const payload = {
      revision: 0,
      siteTitle: '可编辑的站名 · 生活',
      includeAdmin: true,
      overrides,
    };
    expect(
      (await f.dispatch('/api/admin/site-copy', payload, f.other)).status,
    ).toBe(403);
    expect(
      (
        await f.dispatch('/api/admin/site-copy', payload, f.token, {
          Origin: 'https://evil.test',
        })
      ).status,
    ).toBe(403);
    expect((await f.dispatch('/api/admin/site-copy', payload)).status).toBe(
      200,
    );
    expect((await f.dispatch('/api/admin/site-copy', payload)).status).toBe(
      409,
    );
    const home = await (await f.dispatch('/', undefined, false)).text();
    expect(home).toContain('新的首页介绍');
    expect(home).toContain('改过的顶部介绍');
    expect(home).not.toContain('仅后台的导航文案');
    const about = await (await f.dispatch('/about/', undefined, false)).text();
    expect(about).toContain(
      '&lt;script&gt;window.copyInjected=1&lt;/script&gt;',
    );
    expect(about).not.toContain('<script>window.copyInjected');
    expect(
      await (await f.dispatch('/admin/', undefined, false)).text(),
    ).not.toContain('仅后台的导航文案');
    expect(await (await f.dispatch('/admin/')).text()).toContain(
      '仅后台的导航文案',
    );
    const id = 'post-' + crypto.randomUUID();
    await f.dispatch('/api/admin/posts', {
      id,
      revision: 0,
      title: '很高兴，你路过这里。',
      kind: 'article',
      body: '慢慢写，慢慢生活。',
      excerpt: '',
      tags: [],
      location: '',
      pinned: false,
    });
    await f.dispatch('/api/admin/posts/' + id + '/publish', { revision: 1 });
    const detail = await (
      await f.dispatch('/posts/' + id + '/', undefined, false)
    ).text();
    expect(detail).toContain(
      `class="post-title"><a href="/posts/${id}/">很高兴，你路过这里。</a>`,
    );
    expect(detail).toContain('<p>慢慢写，慢慢生活。</p>');
    await f.restart();
    expect(
      await (await f.dispatch('/about/', undefined, false)).text(),
    ).toContain('window.copyInjected');
  } finally {
    await f.close();
  }
});
test('统一后台浏览器：直接发布、编辑、删除/恢复、文案保存及手机布局', async ({
  browser,
}) => {
  const f = await fixture();
  const owner = await browser.newContext(),
    reader = await browser.newContext();
  let releaseSearch: (() => void) | undefined;
  try {
    await routeFixture(owner, f);
    await routeFixture(reader, f, false);
    const page = await owner.newPage();
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(base + '/admin/');
    await expect(page.locator('#dashboard-status')).toContainText('已确认');
    await page
      .getByRole('link', { name: '写一篇新内容 →', exact: true })
      .click();
    await expect(page.getByLabel('正文（Markdown）')).toBeEnabled();
    await page
      .getByRole('combobox', { name: '类型', exact: true })
      .selectOption('article');
    await page.getByLabel('标题', { exact: true }).fill('重构后台浏览器文章');
    await page.getByLabel('正文（Markdown）').fill('可以直接发布的正文。');
    await page.getByRole('button', { name: '发布', exact: true }).click();
    await expect(page.locator('#editor-status')).toContainText('发布成功');
    const id = new URL(page.url()).searchParams.get('id')!;
    await page.getByLabel('正文（Markdown）').fill('发布后修改的正文。');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.locator('#editor-status')).toContainText('已上线');
    const read = await reader.newPage();
    await read.goto(base + '/posts/' + id + '/');
    await expect(read.locator('.post-body')).toContainText('发布后修改');
    await page.goto(base + '/admin/posts/');
    await page.getByLabel('搜索内容').fill('重构后台浏览器文章');
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(page.locator('.admin-post-row')).toHaveCount(1);
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await expect(page.locator('#posts-status')).toContainText('回收站');
    await page.getByLabel('内容状态').selectOption('trash');
    await expect(page.locator('.admin-post-row')).toHaveCount(1);
    await page.getByRole('button', { name: '恢复为草稿', exact: true }).click();
    await expect(page.locator('#posts-status')).toContainText('恢复');
    await page.goto(base + '/admin/site/');
    await expect(page.locator('#copy-form fieldset')).toBeEnabled();
    await page.getByLabel('网站名称', { exact: true }).fill('我的站点 · 新版');
    await page
      .getByLabel('查找文案', { exact: true })
      .fill('很高兴，你路过这里。');
    await page
      .getByLabel('修改文案：很高兴，你路过这里。', { exact: true })
      .fill('这是后台保存的关于页。');
    await page.getByLabel('查找文案', { exact: true }).fill('搜索中…');
    await page
      .getByLabel('修改文案：搜索中…', { exact: true })
      .fill('正在认真找…');
    await page.getByRole('button', { name: '保存文案', exact: true }).click();
    await expect(page.locator('#copy-status')).toContainText('文案已保存');
    await read.goto(base + '/about/');
    await expect(read.locator('.page-heading p')).toHaveText(
      '这是后台保存的关于页。',
    );
    await expect(read).toHaveTitle('关于我 · 我的站点 · 新版');
    await expect(read.locator('[data-site-title]').first()).toHaveText(
      '我的站点 · 新版',
    );
    const pendingSearch = new Promise<void>((resolve) => {
      releaseSearch = resolve;
    });
    await reader.route(base + '/api/search', async (route) => {
      await pendingSearch;
      await route.fallback();
    });
    await read.goto(base + '/search/');
    await read.getByLabel('你想找什么？', { exact: true }).fill('Astro');
    await read.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(
      read.getByRole('button', { name: '正在认真找…', exact: true }),
    ).toBeDisabled();
    releaseSearch?.();
    await expect(
      read.getByRole('button', { name: '搜索', exact: true }),
    ).toBeEnabled();
    for (const route of [
      '/admin/',
      '/admin/posts/',
      '/admin/site/',
      '/admin/write/?id=' + id,
    ]) {
      await page.goto(base + route);
      for (const width of [360, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          route + ' ' + width,
        ).toBe(true);
      }
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(base + '/admin/posts/');
    await page.screenshot({
      path: '/workspace/sfsafi-admin-rebuilt.png',
      fullPage: true,
    });
  } finally {
    releaseSearch?.();
    await owner.unrouteAll({ behavior: 'wait' });
    await reader.unrouteAll({ behavior: 'wait' });
    await owner.close();
    await reader.close();
    await f.close();
  }
});
test('评论邮件：私有邮箱、确认订阅、公开回复、持久去重与退订', async () => {
  const f = await fixture(true);
  try {
    const session = await f.dispatch(
      '/api/engagement?ids=hello-space',
      undefined,
      false,
    );
    const cookie = session.headers.get('set-cookie')!.split(';')[0];
    const id = crypto.randomUUID();
    const body = {
      postId: 'hello-space',
      nickname: '邮箱读者',
      body: '直接显示',
      email: 'Reader@Example.com',
      clientId: id,
    };
    const extra = { Cookie: cookie, 'CF-Connecting-IP': '8.8.8.8' };
    const created = (await (
      await f.dispatch('/api/comments', body, false, extra)
    ).json()) as any;
    expect(created.status).toBe('approved');
    expect(created.emailNotification).toBe('verification_required');
    const visible = await (
      await f.dispatch('/api/comments?postId=hello-space', undefined, false)
    ).text();
    expect(visible).toContain('直接显示');
    expect(visible).not.toContain('reader@example.com');
    expect(
      await (await f.dispatch('/api/admin/comments')).text(),
    ).not.toContain('reader@example.com');
    await (await f.mf.getWorker()).scheduled();
    expect(f.mail.messages).toHaveLength(1);
    expect(f.mail.messages[0].to).toEqual(['reader@example.com']);
    const verify = f.mail.messages[0].text.match(
      /https:\/\/space\.test\/api\/comment-email\/verify\?token=[^\s]+/,
    )[0];
    const verifyPath = new URL(verify).pathname + new URL(verify).search;
    const db = await f.mf.getD1Database('DB');
    expect((await f.dispatch(verifyPath, undefined, false)).status).toBe(200);
    expect(
      (
        (await db
          .prepare(
            'SELECT confirmed_at FROM comment_email_contacts WHERE comment_id=?',
          )
          .bind(id)
          .first()) as any
      ).confirmed_at,
    ).toBeNull();
    expect(
      (await f.dispatch(verifyPath, {}, false, { Origin: 'https://evil.test' }))
        .status,
    ).toBe(403);
    expect((await f.dispatch(verifyPath, {}, false)).status).toBe(200);
    const replyId = crypto.randomUUID();
    const response = await f.dispatch('/api/admin/comments/reply', {
      parentId: id,
      body: '站主回复测试',
      clientId: replyId,
    });
    expect(response.status).toBe(200);
    await f.dispatch('/api/admin/comments/reply', {
      parentId: id,
      body: '站主回复测试',
      clientId: replyId,
    });
    await f.restart();
    await (await f.mf.getWorker()).scheduled();
    expect(f.mail.messages).toHaveLength(2);
    await f.dispatch(
      '/api/comments',
      {
        postId: 'hello-space',
        nickname: '自己',
        body: '自己的回复',
        parentId: id,
        clientId: crypto.randomUUID(),
      },
      false,
      extra,
    );
    await (await f.mf.getWorker()).scheduled();
    expect(f.mail.messages).toHaveLength(2);
    const secondSession = await f.dispatch(
      '/api/engagement?ids=hello-space',
      undefined,
      false,
    );
    const secondCookie = secondSession.headers.get('set-cookie')!.split(';')[0];
    expect(
      (
        await f.dispatch(
          '/api/comments',
          {
            postId: 'hello-space',
            nickname: '其他读者',
            body: '其他读者回复',
            parentId: id,
            clientId: crypto.randomUUID(),
          },
          false,
          { Cookie: secondCookie, 'CF-Connecting-IP': '9.9.9.9' },
        )
      ).status,
    ).toBe(200);
    await (await f.mf.getWorker()).scheduled();
    expect(f.mail.messages).toHaveLength(3);
    expect(f.mail.messages[2].text).toContain('其他读者回复');
    expect(f.mail.messages[1].text).toContain('站主回复测试');
    expect(f.mail.messages[1].text).toContain('#comment-' + replyId);
    await (await f.mf.getWorker()).scheduled();
    expect(f.mail.messages).toHaveLength(3);
    const unsubscribe = f.mail.messages[1].text.match(
      /https:\/\/space\.test\/api\/comment-email\/unsubscribe\?token=[^\s]+/,
    )[0];
    const path = new URL(unsubscribe).pathname + new URL(unsubscribe).search;
    expect((await f.dispatch(path, undefined, false)).status).toBe(200);
    expect((await f.dispatch(path, {}, false)).status).toBe(200);
    const restartedDb = await f.mf.getD1Database('DB');
    expect(
      (
        (await restartedDb
          .prepare(
            'SELECT email FROM comment_email_contacts WHERE comment_id=?',
          )
          .bind(id)
          .first()) as any
      ).email,
    ).toBe('');
    await f.dispatch('/api/admin/comments/reply', {
      parentId: id,
      body: '退订后回复',
      clientId: crypto.randomUUID(),
    });
    await (await f.mf.getWorker()).scheduled();
    expect(f.mail.messages).toHaveLength(3);
    expect((await f.dispatch(verifyPath, {}, false)).status).toBe(410);
  } finally {
    await f.close();
  }
});

test('评论邮件：未确认不发送回复、删除撤回隔离、服务失败不伪装成功', async () => {
  const f = await fixture(true);
  try {
    const session = await f.dispatch(
      '/api/engagement?ids=hello-space',
      undefined,
      false,
    );
    const cookie = session.headers.get('set-cookie')!.split(';')[0];
    const id = crypto.randomUUID();
    const extra = { Cookie: cookie, 'CF-Connecting-IP': '7.7.7.7' };
    expect(
      (
        await f.dispatch(
          '/api/comments',
          {
            postId: 'hello-space',
            nickname: '访客',
            body: '邮箱错误',
            email: 'bad\r\nBcc:a@b.com',
            clientId: crypto.randomUUID(),
          },
          false,
          extra,
        )
      ).status,
    ).toBe(400);
    await f.dispatch(
      '/api/comments',
      {
        postId: 'hello-space',
        nickname: '访客',
        body: '邮件测试',
        email: 'reader@example.com',
        clientId: id,
      },
      false,
      extra,
    );
    await f.dispatch('/api/admin/comments/reply', {
      parentId: id,
      body: '验证前回复',
      clientId: crypto.randomUUID(),
    });
    f.mail.mode = 'missing';
    await (await f.mf.getWorker()).scheduled();
    expect(f.mail.messages).toHaveLength(1);
    const db = await f.mf.getD1Database('DB');
    expect(
      (
        (await db
          .prepare("SELECT status FROM comment_mail WHERE kind='verify'")
          .first()) as any
      ).status,
    ).toBe('uncertain');
    await (await f.mf.getWorker()).scheduled();
    expect(f.mail.messages).toHaveLength(1);
    expect(
      (
        await f.dispatch(
          '/api/admin/comments',
          { id, revision: 1, status: 'deleted' },
          f.other,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await f.dispatch('/api/admin/comments', {
          id,
          revision: 1,
          status: 'deleted',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        (await db
          .prepare(
            'SELECT email FROM comment_email_contacts WHERE comment_id=?',
          )
          .bind(id)
          .first()) as any
      ).email,
    ).toBe('');
    expect(
      (
        (await (
          await f.dispatch('/api/comments?postId=hello-space', undefined, false)
        ).json()) as any
      ).items,
    ).toHaveLength(0);
    expect(
      (
        (await db
          .prepare("SELECT status FROM comment_mail WHERE kind='reply'")
          .first()) as any
      ).status,
    ).toBe('canceled');
    const newId = crypto.randomUUID();
    await f.dispatch(
      '/api/comments',
      {
        postId: 'hello-space',
        nickname: '访客',
        body: '额度测试',
        email: 'second@example.com',
        clientId: newId,
      },
      false,
      extra,
    );
    const day = Math.floor((Date.now() / 1000 + 28800) / 86400);
    await db
      .prepare(
        "UPDATE comment_limits SET window=?,count=100 WHERE bucket='mail-global'",
      )
      .bind(day)
      .run();
    f.mail.mode = 'ok';
    await (await f.mf.getWorker()).scheduled();
    expect(f.mail.messages).toHaveLength(1);
    expect(
      (
        (await db
          .prepare('SELECT status,next_at FROM comment_mail WHERE contact_id=?')
          .bind(newId)
          .first()) as any
      ).status,
    ).toBe('queued');
  } finally {
    await f.close();
  }
});
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
test('真实本地 D1 浏览器写文、预览、发布及评论管理；读者不能写文', async ({
  browser,
}) => {
  const f = await fixture();
  const context = await browser.newContext();
  let visitor: BrowserContext | undefined;
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
    visitor = await browser.newContext();
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
      '评论已发布。',
    );
    expect(await read.locator('[data-comments-list]').textContent()).toContain(
      'onerror',
    );
    await expect(read.locator('[data-comments-list] img')).toHaveCount(0);
    await expect(read.getByLabel('邮箱（选填）')).toBeDisabled();
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
    await visitor.unrouteAll({ behavior: 'wait' });
    await visitor.close();
    visitor = undefined;
  } finally {
    if (visitor) {
      await visitor.unrouteAll({ behavior: 'wait' });
      await visitor.close();
    }
    await context.unrouteAll({ behavior: 'wait' });
    await context.close();
    await f.close();
  }
});
test('评论 API：幂等提交、直接公开/父评论隔离、限流及跨站拒绝', async () => {
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
    ).toHaveLength(1);
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
