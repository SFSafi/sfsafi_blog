import { formatDate } from './date';
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败，请重试。'));
    image.src = src;
  });
}
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const char of [...paragraph]) {
      if (ctx.measureText(line + char).width > width && line) {
        lines.push(line);
        line = '';
      }
      line += char;
    }
    lines.push(line);
  }
  return lines;
}
for (const section of document.querySelectorAll<HTMLElement>('[data-share]')) {
  const url = new URL(section.dataset.sharePath!, window.location.origin).href;
  const status = section.querySelector<HTMLElement>('[data-share-status]')!;
  const copy = section.querySelector<HTMLButtonElement>('[data-copy-link]')!;
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      status.textContent = '链接已复制。';
    } catch {
      status.replaceChildren();
      const field = document.createElement('input');
      field.value = url;
      field.readOnly = true;
      field.setAttribute('aria-label', '分享链接，请手动复制');
      status.append(field);
      field.focus();
      field.select();
    }
  });
  const button = section.querySelector<HTMLButtonElement>(
    '[data-share-image-button]',
  )!;
  const dialog = section.querySelector<HTMLDialogElement>('dialog')!;
  let blob: Blob | null = null;
  let objectUrl: string | null = null;
  section
    .querySelector('[data-share-close]')!
    .addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => button.focus());
  const native = section.querySelector<HTMLButtonElement>(
    '[data-share-native]',
  )!;
  native.addEventListener('click', async () => {
    if (!blob) return;
    try {
      await navigator.share({
        files: [new File([blob], 'sfsafi-post.png', { type: 'image/png' })],
        title: section.dataset.shareTitle,
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError'))
        status.textContent = '系统分享未完成，请保存图片后分享。';
    }
  });
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    status.textContent = '正在生成图片…';
    try {
      const { default: QRCode } = await import('qrcode');
      const avatar = document.querySelector<HTMLImageElement>(
        '[data-profile-avatar]',
      );
      const name =
        document.querySelector('[data-profile-name]')?.textContent || 'SFSafi';
      const body = [...section.dataset.shareBody!].slice(0, 600).join('');
      await document.fonts.load('500 28px MiSans', body + name);
      const canvas = document.createElement('canvas');
      canvas.width = 900;
      const ctx = canvas.getContext('2d')!;
      ctx.font = '500 28px MiSans, sans-serif';
      const lines = wrap(ctx, body, 772);
      const textHeight = lines.length * 48;
      let photo: HTMLImageElement | null = null;
      if (section.dataset.shareImage)
        photo = await loadImage(
          new URL(section.dataset.shareImage, location.origin).href,
        );
      canvas.height = 460 + textHeight + (photo ? 460 : 0);
      ctx.fillStyle = '#f7f8f3';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#e9eee3';
      ctx.fillRect(40, 40, 820, canvas.height - 80);
      ctx.fillStyle = '#fff';
      ctx.fillRect(48, 48, 804, canvas.height - 96);
      if (avatar) {
        const picture = await loadImage(avatar.src);
        ctx.save();
        ctx.beginPath();
        ctx.arc(96, 102, 32, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(picture, 64, 70, 64, 64);
        ctx.restore();
      }
      ctx.fillStyle = '#29352e';
      ctx.font = '500 27px MiSans, sans-serif';
      ctx.fillText(name, 146, 96);
      ctx.fillStyle = '#69736b';
      ctx.font = '500 20px MiSans, sans-serif';
      ctx.fillText(formatDate(section.dataset.shareDate!), 146, 129);
      let y = 184;
      ctx.fillStyle = '#29352e';
      ctx.font = '500 32px MiSans, sans-serif';
      ctx.fillText(section.dataset.shareTitle!, 64, y, 772);
      y += 52;
      ctx.font = '500 28px MiSans, sans-serif';
      for (const line of lines) {
        ctx.fillText(line, 64, y);
        y += 48;
      }
      if (photo) {
        y += 12;
        const scale = Math.min(
          772 / photo.naturalWidth,
          420 / photo.naturalHeight,
        );
        const w = photo.naturalWidth * scale;
        const h = photo.naturalHeight * scale;
        ctx.drawImage(photo, 64 + (772 - w) / 2, y, w, h);
        y += 440;
      }
      ctx.fillStyle = '#69736b';
      ctx.font = '500 20px MiSans, sans-serif';
      if (section.dataset.shareLocation) {
        ctx.fillText('地点 · ' + section.dataset.shareLocation, 64, y);
        y += 32;
      }
      const qr = document.createElement('canvas');
      await QRCode.toCanvas(qr, url, {
        width: 110,
        margin: 1,
        errorCorrectionLevel: 'M',
      });
      const bottom = canvas.height - 172;
      ctx.drawImage(qr, 64, bottom, 110, 110);
      ctx.font = '500 22px MiSans, sans-serif';
      ctx.fillStyle = '#476852';
      ctx.fillText('扫码，读完整记录', 198, bottom + 35);
      ctx.font = '500 16px MiSans, sans-serif';
      ctx.fillStyle = '#69736b';
      for (const [index, line] of wrap(ctx, url, 605).entries())
        ctx.fillText(line, 198, bottom + 67 + index * 24);
      blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value ? resolve(value) : reject(new Error('图片生成失败。')),
          'image/png',
        ),
      );
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(blob);
      section.querySelector<HTMLImageElement>('[data-share-preview]')!.src =
        objectUrl;
      section.querySelector<HTMLAnchorElement>('[data-share-download]')!.href =
        objectUrl;
      native.hidden = !navigator.canShare?.({
        files: [new File([blob], 'sfsafi-post.png', { type: 'image/png' })],
      });
      dialog.showModal();
      status.textContent = '图片已生成。';
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : '生成失败，请重试。';
    } finally {
      button.disabled = false;
    }
  });
}
