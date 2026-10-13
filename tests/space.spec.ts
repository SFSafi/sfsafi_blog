import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

for (const width of [360, 390, 768, 1440]) {
  test(`公开页面在 ${width}px 无横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    for (const path of [
      '/',
      '/page/2/',
      '/articles/',
      '/tags/',
      '/tags/日常/',
      '/about/',
      '/posts/afternoon-walk/',
      '/posts/making-a-home/',
      '/posts/flowers-in-motion/',
      '/404',
    ]) {
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await expect(page.locator('main')).toBeVisible();
    }
  });
}
test('主题记忆、系统深色和字体失败回退', async ({ page }) => {
  await page.goto('/');
  for (const theme of ['light', 'dark', 'sage']) {
    await page.locator('#theme').selectOption(theme);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('#theme')).toHaveValue(theme);
  }
  await page.locator('#theme').selectOption('system');
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(
    await page
      .locator('body')
      .evaluate((e) => getComputedStyle(e).backgroundColor),
  ).toBe('rgb(23, 29, 26)');
  await page.route('**/*.woff2', (route) => route.abort());
  await page.reload();
  await expect(
    page.getByRole('heading', { name: '此刻，与日常。' }),
  ).toBeVisible();
});
test('图组完整图片、键盘切换、焦点归还', async ({ page }) => {
  await page.goto('/posts/afternoon-walk/');
  const first = page.locator('[data-image]').first();
  await first.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('#full-image')).toHaveAttribute(
    'src',
    '/media/landscape.svg',
  );
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#full-image')).toHaveAttribute(
    'src',
    '/media/window.svg',
  );
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#full-image')).toHaveAttribute(
    'src',
    '/media/landscape.svg',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(first).toBeFocused();
});
test('视频不会预先下载，点击后能播放', async ({ page }) => {
  let loaded = false;
  page.on('request', (req) => {
    if (req.url().endsWith('flower.mp4')) loaded = true;
  });
  await page.goto('/posts/flowers-in-motion/');
  const video = page.locator('video');
  await expect(video).toHaveAttribute('preload', 'none');
  expect(loaded).toBe(false);
  expect(
    await video.evaluate((v: HTMLVideoElement) => v.paused && !v.autoplay),
  ).toBe(true);
  await video.evaluate((v: HTMLVideoElement) => v.play());
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0);
  expect(loaded).toBe(true);
});
test('媒体失败提示及视频重试', async ({ page }) => {
  await page.route('**/media/landscape.svg', (route) => route.abort());
  await page.goto('/posts/afternoon-walk/');
  await expect(page.locator('.media-error').first()).toBeVisible();
  await page.route('**/media/flower.mp4', (route) => route.abort());
  await page.goto('/posts/flowers-in-motion/');
  await page.locator('video').evaluate((v: HTMLVideoElement) => {
    v.play().catch(() => {});
  });
  await expect(page.locator('.video-error')).toBeVisible();
  await page.unroute('**/media/flower.mp4');
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.video-error')).toBeHidden();
  await page.locator('video').evaluate((v: HTMLVideoElement) => v.play());
  await expect
    .poll(() =>
      page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeGreaterThan(0);
});
test('分页、稳定链接、公开构建无草稿', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('.post-card')).toHaveCount(4);
  await expect(page.locator('.post-card').first()).toContainText('置顶');
  await page.getByRole('link', { name: /看看更早/ }).click();
  await expect(page.locator('.post-card')).toHaveCount(3);
  expect((await request.get('/posts/private-draft/')).status()).toBe(404);
  const walk = (dir: string): void => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isDirectory()) walk(path);
      else if (/\.(html|js|json)$/.test(path)) {
        expect(readFileSync(path, 'utf8')).not.toContain(
          'DRAFT_SENTINEL_NEVER_PUBLIC',
        );
      }
    }
  };
  walk('dist');
  await page.goto('/');
  const links = await page
    .locator('a[href^="/"]')
    .evaluateAll((links) => [
      ...new Set(links.map((a) => a.getAttribute('href')!)),
    ]);
  for (const link of links)
    expect((await request.get(link)).status()).toBe(200);
});
test('保存界面截图', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: testInfo.outputPath('desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath('mobile.png'),
    fullPage: true,
  });
  await page.locator('#theme').selectOption('dark');
  await page.screenshot({
    path: testInfo.outputPath('dark.png'),
    fullPage: true,
  });
});
