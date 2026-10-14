export {};
const form = document.querySelector<HTMLFormElement>('#media-form')!;
const fieldset = form.querySelector<HTMLFieldSetElement>('fieldset')!;
const status = document.querySelector<HTMLElement>('#media-status')!;
const input = form.elements.namedItem('file') as HTMLInputElement;
const preset = form.elements.namedItem('preset') as HTMLSelectElement;
const keep = form.elements.namedItem('keepOriginal') as HTMLInputElement;
const progress =
  document.querySelector<HTMLProgressElement>('#media-progress')!;
const cancel = document.querySelector<HTMLButtonElement>('#media-cancel')!;
const retry = document.querySelector<HTMLButtonElement>('#media-retry')!;
const result = document.querySelector<HTMLElement>('#media-result')!;
const base = '/api/admin/media';
let upload: XMLHttpRequest | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const size = (bytes: number) => (bytes / 1024 / 1024).toFixed(2) + ' MiB';
async function get(path: string) {
  const response = await fetch(base + path, {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.headers.get('Content-Type')?.includes('application/json'))
    throw Error('登录已失效，请刷新页面重新登录。');
  const data = await response.json();
  if (!response.ok) throw Error(data.error || '读取失败。');
  return data;
}
async function poll(id: string) {
  try {
    const job = await get('/jobs/' + id);
    if (job.status === 'ready') {
      const data = job.result;
      status.textContent =
        `处理完成：原始 ${size(data.input.bytes)} → 播放版本 ${size(data.output.bytes)}；${data.output.width} × ${data.output.height}，${data.output.duration.toFixed(1)} 秒。实际保存 ${size(data.storedBytes)}。` +
        (data.savedRatio > 0
          ? `播放版本减少 ${(data.savedRatio * 100).toFixed(1)}%。`
          : data.warning);
      const video = document.createElement('video');
      video.controls = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.style.maxWidth = '100%';
      video.src = base + '/jobs/' + id + '/playback';
      video.poster = base + '/jobs/' + id + '/poster';
      result.replaceChildren(video);
      if (data.originalRetained) {
        const link = document.createElement('a');
        link.href = base + '/jobs/' + id + '/original';
        link.textContent = '下载保留的原素材';
        result.append(link);
      }
      fieldset.disabled = false;
      return;
    }
    if (job.status === 'failed') throw Error(job.error || '转码失败。');
    status.textContent =
      job.status === 'processing'
        ? 'FFmpeg 正在转码，完成后会自动显示预览；可以稍后返回此页面。'
        : '视频已接收，等待转码；可以稍后返回此页面。';
    timer = setTimeout(() => void poll(id), 3000);
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : '读取转码状态失败。';
    fieldset.disabled = false;
    retry.hidden = !input.files?.length;
  }
}
function start() {
  const file = input.files?.[0];
  if (!file) return;
  if (!file.size || file.size > 64 * 1024 * 1024) {
    status.textContent = '请选择不超过 64 MiB 的视频。';
    return;
  }
  if (timer) clearTimeout(timer);
  fieldset.disabled = true;
  retry.hidden = true;
  cancel.hidden = false;
  progress.hidden = false;
  progress.value = 0;
  result.replaceChildren();
  status.textContent = `正在上传 ${size(file.size)}；上传后自动转码。`;
  const xhr = new XMLHttpRequest();
  upload = xhr;
  xhr.open(
    'POST',
    base + '/jobs?preset=' + preset.value + '&keepOriginal=' + keep.checked,
  );
  xhr.timeout = 120000;
  xhr.setRequestHeader('Content-Type', 'application/octet-stream');
  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable)
      progress.value = (event.loaded / event.total) * 100;
  };
  const failed = (message: string) => {
    status.textContent = message;
    fieldset.disabled = false;
    retry.hidden = false;
    cancel.hidden = true;
    progress.hidden = true;
    upload = undefined;
  };
  xhr.onload = () => {
    try {
      const data = JSON.parse(xhr.responseText);
      if (xhr.status !== 202) throw Error(data.error || '上传失败。');
      if (!/^[a-f0-9-]{36}$/.test(data.id)) throw Error('任务编号无效。');
      history.replaceState(null, '', '?job=' + data.id);
      cancel.hidden = true;
      progress.hidden = true;
      upload = undefined;
      void poll(data.id);
    } catch (error) {
      failed(
        error instanceof Error ? error.message : '上传失败，请重新登录或重试。',
      );
    }
  };
  xhr.onerror = () => failed('上传连接失败，所选文件仍在设备中。');
  xhr.ontimeout = () => failed('上传超时，请重试。');
  xhr.onabort = () => failed('已取消本次上传。');
  xhr.send(file);
}
form.addEventListener('submit', (event) => event.preventDefault());
preset.addEventListener('change', () => {
  keep.disabled = preset.value === 'original';
  if (keep.disabled) keep.checked = true;
});
input.addEventListener('change', start);
retry.addEventListener('click', start);
cancel.addEventListener('click', () => upload?.abort());
window.addEventListener('pagehide', () => {
  if (timer) clearTimeout(timer);
});
void (async () => {
  try {
    await get('/health');
    const id = new URLSearchParams(location.search).get('job');
    if (id && /^[a-f0-9-]{36}$/.test(id)) await poll(id);
    else {
      fieldset.disabled = false;
      status.textContent =
        '服务已连接。选择视频后自动上传并转码，默认标准档、不保留原素材。';
    }
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : '服务不可用。';
  }
})();
