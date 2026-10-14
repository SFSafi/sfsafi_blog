import { adminRequest } from './admin-request';
import {
  parseWritingArchive,
  restoreFields,
  type WritingArchive,
} from './backup';
const controls =
    document.querySelector<HTMLFieldSetElement>('#backup-controls')!,
  status = document.querySelector('#backup-status')!;
const file = document.querySelector<HTMLInputElement>('#backup-file')!,
  select = document.querySelector<HTMLSelectElement>('#backup-post')!,
  preview = document.querySelector<HTMLElement>('#backup-preview')!;
const restore = document.querySelector<HTMLButtonElement>('#backup-restore')!,
  open = document.querySelector<HTMLAnchorElement>('#backup-open')!;
let archive: WritingArchive | undefined,
  restoreId = '',
  busy = false;
function selected() {
  const post = archive?.posts[Number(select.value)];
  preview.replaceChildren();
  open.hidden = true;
  restore.disabled = !post;
  restoreId = 'post-' + crypto.randomUUID();
  if (post) {
    const title = document.createElement('h3'),
      body = document.createElement('p');
    title.textContent = post.title || '一条动态';
    body.textContent = post.body;
    preview.append(title, body);
  }
  preview.hidden = !post;
}
select.addEventListener('change', selected);
file.addEventListener('change', async () => {
  archive = undefined;
  select.replaceChildren();
  select.disabled = true;
  restore.disabled = true;
  preview.hidden = true;
  open.hidden = true;
  const uploaded = file.files?.[0];
  if (!uploaded) return;
  try {
    if (uploaded.size > 5 * 1024 * 1024) throw Error('备份文件最多 5 MiB。');
    archive = parseWritingArchive(await uploaded.text());
    archive.posts.forEach((p, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = p.title || p.body.slice(0, 40);
      option.setAttribute('data-user-content', '');
      select.append(option);
    });
    select.disabled = !archive.posts.length;
    selected();
    status.textContent = `已读取 ${archive.posts.length} 篇内容，选择一篇恢复。`;
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : '备份文件无法读取。';
  }
});
document
  .querySelector('#backup-export')!
  .addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    controls.disabled = true;
    status.textContent = '正在生成备份…';
    try {
      const data = await adminRequest('/api/admin/backups/export');
      const url = URL.createObjectURL(
          new Blob([JSON.stringify(data)], {
            type: 'application/json',
          }),
        ),
        link = document.createElement('a');
      link.href = url;
      link.download = `sfsafi-writing-${data.createdAt.slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      status.textContent = '备份已下载。请妥善保存，其中包含私有草稿。';
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : '备份下载失败。';
    } finally {
      busy = false;
      controls.disabled = false;
    }
  });
restore.addEventListener('click', async () => {
  const post = archive?.posts[Number(select.value)];
  if (!post || busy) return;
  const fields = restoreFields(post);
  busy = true;
  controls.disabled = true;
  status.textContent = '正在恢复草稿…';
  try {
    let result;
    try {
      result = await adminRequest('/api/admin/posts', {
        id: restoreId,
        revision: 0,
        ...fields,
      });
    } catch (error) {
      const existing = await adminRequest(
        '/api/admin/posts/' + restoreId,
      ).catch(() => null);
      if (
        !existing ||
        existing.status !== 'draft' ||
        existing.deletedAt ||
        existing.body !== fields.body ||
        existing.title !== fields.title ||
        existing.bodyFormat !== fields.bodyFormat
      )
        throw error;
      result = existing;
    }
    open.href = '/admin/write/?id=' + encodeURIComponent(result.id);
    open.hidden = false;
    restore.disabled = true;
    status.textContent = '已恢复为新草稿，检查后可自行发布。';
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : '恢复失败。';
  } finally {
    busy = false;
    controls.disabled = false;
  }
});
void (async () => {
  try {
    const data = await adminRequest('/api/admin/backups');
    controls.disabled = false;
    status.textContent = `当前共有 ${data.posts} 篇内容可备份。`;
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : '身份验证失败。';
  }
})();
