import { test, expect } from '@playwright/test';
const base = 'http://127.0.0.1:8787';
test('真实本地 D1：阅览去重、并发赞互斥与取消', async ({ playwright }) => {
  const context = await playwright.request.newContext({ baseURL: base });
  const id = 'weekend-list';
  const before = (
    await (await context.get(`/api/engagement?ids=${id}`)).json()
  )[0];
  const views = await Promise.all(
    Array.from({ length: 10 }, () =>
      context.post(`/api/engagement/${id}/view`, {
        headers: { Origin: base },
        data: {},
      }),
    ),
  );
  for (const response of views) expect(response.status()).toBe(200);
  let stats = (
    await (await context.get(`/api/engagement?ids=${id}`)).json()
  )[0];
  expect(stats.views).toBe(before.views + 1);
  const likes = await Promise.all(
    Array.from({ length: 10 }, () =>
      context.post(`/api/engagement/${id}/vote`, {
        headers: { Origin: base },
        data: { vote: 1 },
      }),
    ),
  );
  for (const response of likes) expect(response.status()).toBe(200);
  stats = (await (await context.get(`/api/engagement?ids=${id}`)).json())[0];
  expect(stats.likes).toBe(before.likes + 1);
  expect(stats.dislikes).toBe(before.dislikes);
  expect(stats.myVote).toBe(1);
  const switched = await (
    await context.post(`/api/engagement/${id}/vote`, {
      headers: { Origin: base },
      data: { vote: -1 },
    })
  ).json();
  expect(switched.likes).toBe(before.likes);
  expect(switched.dislikes).toBe(before.dislikes + 1);
  expect(switched.myVote).toBe(-1);
  const cancelled = await (
    await context.post(`/api/engagement/${id}/vote`, {
      headers: { Origin: base },
      data: { vote: 0 },
    })
  ).json();
  expect(cancelled.likes).toBe(before.likes);
  expect(cancelled.dislikes).toBe(before.dislikes);
  expect(cancelled.myVote).toBe(0);
  await context.dispose();
});
test('真实 API 拒绝草稿、伪造访客、跨站写入和未授权资料操作', async ({
  request,
}) => {
  expect(
    (await request.get(base + '/api/engagement?ids=private-draft')).status(),
  ).toBe(404);
  await request.get(base + '/api/engagement?ids=hello-space');
  expect(
    (
      await request.post(base + '/api/engagement/hello-space/vote', {
        headers: { Origin: 'https://evil.example' },
        data: { vote: 1 },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post(base + '/api/engagement/hello-space/vote', {
        headers: { Origin: base },
        data: { vote: 99 },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post(base + '/api/engagement/hello-space/vote', {
        headers: { Origin: base, Cookie: 'space_visitor=' + 'a'.repeat(64) },
        data: { vote: 1 },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post(base + '/api/admin/profile', {
        headers: { Origin: base },
        multipart: { nickname: 'attacker' },
      })
    ).status(),
  ).toBe(401);
  const missing = await request.get(base + '/api/engagement');
  expect(missing.status()).toBe(400);
});
test('真实 D1 限制同一访客的连续请求', async ({ playwright }) => {
  const context = await playwright.request.newContext({ baseURL: base });
  await context.get('/api/engagement?ids=readable-web');
  const results = await Promise.all(
    Array.from({ length: 130 }, () =>
      context.get('/api/engagement?ids=readable-web'),
    ),
  );
  expect(results.some((r) => r.status() === 429)).toBe(true);
  await context.dispose();
});
test('浏览器点赞、刷新保留、手动地点与二维码图片分享', async ({
  page,
}, testInfo) => {
  await page.goto(base + '/posts/less-but-better/');
  const like = page.locator('[data-vote="1"]');
  await expect(like).toBeEnabled();
  await like.click();
  await expect(like).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(like).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-vote="-1"]').click();
  await expect(like).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-vote="-1"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.goto(base + '/posts/afternoon-walk/');
  await page.getByRole('link', { name: /湖边 · 示例地点/ }).click();
  await expect(page).toHaveURL(new RegExp('/locations/\\?place='));
  await page.goto(base + '/posts/afternoon-walk/');
  await page.getByRole('button', { name: '生成分享图片' }).click();
  await expect(page.locator('.share-dialog')).toBeVisible();
  await expect(page.locator('[data-share-preview]')).toHaveAttribute(
    'src',
    /^blob:/,
  );
  const dimensions = await page
    .locator('[data-share-preview]')
    .evaluate((img: HTMLImageElement) => ({
      width: img.naturalWidth,
      height: img.naturalHeight,
    }));
  expect(dimensions.width).toBe(900);
  expect(dimensions.height).toBeGreaterThan(500);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '保存图片' }).click();
  await (await download).saveAs(testInfo.outputPath('share-poster.png'));
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: '生成分享图片' }),
  ).toBeFocused();
});
test('复制链接使用稳定地址', async ({ browser }) => {
  const context = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  await page.goto(base + '/posts/hello-space/');
  await page.getByRole('button', { name: '复制链接' }).click();
  await expect(page.locator('[data-share-status]')).toHaveText('链接已复制。');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    base + '/posts/hello-space/',
  );
  await context.close();
});
