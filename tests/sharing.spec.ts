import { test, expect } from '@playwright/test';
test('纯静态部署：复制稳定链接', async ({ browser }) => {
  const context = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4321/posts/hello-space/');
  await page.getByRole('button', { name: '复制链接' }).click();
  await expect(page.locator('[data-share-status]')).toHaveText('链接已复制。');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'http://127.0.0.1:4321/posts/hello-space/',
  );
  await context.close();
});
test('纯静态部署：分享 PNG 与键盘关闭', async ({ page }, testInfo) => {
  await page.goto('/posts/afternoon-walk/');
  const button = page.getByRole('button', { name: '生成分享图片' });
  await button.click();
  const dialog = page.getByRole('dialog', { name: '分享图片预览' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-share-preview]')).toHaveAttribute(
    'src',
    /^blob:/,
  );
  await expect
    .poll(() =>
      page
        .locator('[data-share-preview]')
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBe(900);
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: '保存图片' }).click();
  await (await download).saveAs(testInfo.outputPath('share-example.png'));
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
});
