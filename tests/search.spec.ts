import { test, expect } from '@playwright/test';
import { Miniflare, createFetchMock } from 'miniflare';
import { readFileSync } from 'node:fs';
const script = () => readFileSync('/tmp/sfsafi-worker-bundle/index.js', 'utf8');
function options(extra: Record<string, unknown> = {}) {
  return {
    script: script(),
    modules: true,
    compatibilityDate: '2026-06-01',
    d1Databases: { DB: 'search-test' },
    ...extra,
  };
}
function payload(query: string, ip = '1.2.3.4') {
  return {
    method: 'POST',
    headers: {
      Origin: 'https://example.com',
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
    },
    body: JSON.stringify({ query }),
  };
}
test('搜索：公开内容隔离、参数及来源校验、未配置回退和浏览器交互', async ({
  page,
}) => {
  const mf = new Miniflare(options());
  try {
    expect(
      await (await mf.dispatchFetch('https://example.com/api/search')).json(),
    ).toEqual({ aiAvailable: false });
    const result = (await (
      await mf.dispatchFetch('https://example.com/api/search', payload('Astro'))
    ).json()) as any;
    expect(result.mode).toBe('keyword');
    expect(result.sources[0].id).toBe('making-a-home');
    expect(JSON.stringify(result)).not.toContain('DRAFT_SENTINEL');
    const draft = (await (
      await mf.dispatchFetch(
        'https://example.com/api/search',
        payload('DRAFT_SENTINEL_NEVER_PUBLIC'),
      )
    ).json()) as any;
    expect(draft.sources).toEqual([]);
    expect(
      (await mf.dispatchFetch('https://example.com/api/search', payload('')))
        .status,
    ).toBe(400);
    expect(
      (
        await mf.dispatchFetch(
          'https://example.com/api/search',
          payload('x'.repeat(201)),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await mf.dispatchFetch('https://example.com/api/search', {
          ...payload('Astro'),
          headers: {
            Origin: 'https://evil.com',
            'Content-Type': 'application/json',
          },
        })
      ).status,
    ).toBe(403);
    await page.route('**/api/search', async (route) => {
      const body = route.request().postDataJSON();
      const response = await mf.dispatchFetch(
        'https://example.com/api/search',
        payload(body.query),
      );
      await route.fulfill({
        status: response.status,
        contentType: 'application/json',
        body: await response.text(),
      });
    });
    await page.goto('/search/');
    await page.getByLabel('你想找什么？').fill('Astro');
    await page.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(page.locator('#search-results a').first()).toHaveAttribute(
      'href',
      '/posts/making-a-home/',
    );
    for (const width of [360, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  } finally {
    await mf.dispose();
  }
});
test('AI 搜索：真实 Worker 请求协议、引用约束、失败回退及原子额度限制', async () => {
  let calls = 0;
  const outboundService = async (request: any) => {
    calls++;
    expect(request.url).toBe('https://model.example/v1/chat/completions');
    expect(request.method).toBe('POST');
    expect(request.headers.get('Authorization')).toBe('Bearer test-only-key');
    const body = await request.json();
    expect(body.model).toBe('test-model');
    expect(body.max_tokens).toBe(700);
    const context = JSON.parse(body.messages[1].content);
    expect(context.question).toBe('Astro');
    expect(JSON.stringify(context)).not.toContain('DRAFT_SENTINEL');
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                answer: '可以阅读 Astro 建站记录。',
                sourceIds: ['making-a-home'],
              }),
            },
          },
        ],
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  };
  const bindings = {
    AI_API_KEY: 'test-only-key',
    AI_BASE_URL: 'https://model.example/v1',
    AI_MODEL: 'test-model',
    AI_DAILY_LIMIT: '2',
  };
  const mf = new Miniflare(options({ bindings, outboundService }));
  try {
    for (let i = 0; i < 2; i++) {
      const result = (await (
        await mf.dispatchFetch(
          'https://example.com/api/search',
          payload('Astro'),
        )
      ).json()) as any;
      expect(result.mode, JSON.stringify(result)).toBe('ai');
      expect(result.sources[0].path).toBe('/posts/making-a-home/');
      expect(JSON.stringify(result)).not.toContain('test-only-key');
    }
    const limited = (await (
      await mf.dispatchFetch('https://example.com/api/search', payload('Astro'))
    ).json()) as any;
    expect(limited.mode).toBe('keyword');
    expect(limited.notice).toContain('额度');
    expect(calls).toBe(2);

    for (let i = 0; i < 3; i++)
      await mf.dispatchFetch(
        'https://example.com/api/search',
        payload('Astro'),
      );
    expect(
      (
        await mf.dispatchFetch(
          'https://example.com/api/search',
          payload('Astro'),
        )
      ).status,
    ).toBe(429);
  } finally {
    await mf.dispose();
  }
  const badMock = createFetchMock();
  badMock.disableNetConnect();
  badMock
    .get('https://model.example')
    .intercept({ path: '/v1/chat/completions', method: 'POST' })
    .reply(
      200,
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                answer: '<script>alert(1)</script>',
                sourceIds: ['private-draft'],
              }),
            },
          },
        ],
      }),
    )
    .persist();
  const bad = new Miniflare(options({ bindings, fetchMock: badMock }));
  try {
    const result = (await (
      await bad.dispatchFetch(
        'https://example.com/api/search',
        payload('Astro'),
      )
    ).json()) as any;
    expect(result.mode).toBe('keyword');
    expect(JSON.stringify(result)).not.toContain('private-draft');
  } finally {
    await bad.dispose();
  }
});
