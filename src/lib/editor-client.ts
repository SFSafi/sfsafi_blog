import type { Post } from './content';
import { adminRequest } from './admin-request';
const form = document.querySelector<HTMLFormElement>('#editor-form')!,
  fieldset = form.querySelector<HTMLFieldSetElement>('fieldset')!,
  status = document.querySelector<HTMLElement>('#editor-status')!;
const publish = document.querySelector<HTMLButtonElement>('#editor-publish')!,
  withdraw = document.querySelector<HTMLButtonElement>('#editor-withdraw')!,
  live = document.querySelector<HTMLAnchorElement>('#editor-live-link')!,
  preview = document.querySelector<HTMLElement>('#editor-preview-panel')!;
const archive = document.querySelector<HTMLButtonElement>('#editor-archive')!;
let id =
    new URLSearchParams(location.search).get('id') ||
    'post-' + crypto.randomUUID(),
  revision = 0,
  dirty = false,
  current: Post | undefined,
  busy = false;
const field = (name: string) =>
  form.elements.namedItem(name) as HTMLInputElement;
const request = adminRequest;
function loaded(post: Post) {
  current = post;
  for (const input of form.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >('input,textarea,select'))
    input.disabled = Boolean(post.deletedAt);
  form.querySelector<HTMLButtonElement>('[type=submit]')!.disabled = Boolean(
    post.deletedAt,
  );
  document.querySelector<HTMLButtonElement>('#editor-preview')!.disabled =
    Boolean(post.deletedAt);
  document.querySelector<HTMLButtonElement>('#editor-delete')!.hidden = Boolean(
    post.deletedAt,
  );
  document.querySelector<HTMLButtonElement>('#editor-restore')!.hidden =
    !post.deletedAt;
  id = post.id;
  revision = post.revision;
  for (const name of ['kind', 'title', 'body', 'excerpt'])
    field(name).value = String(post[name as keyof Post] || '');
  field('tags').value = post.tags.join(', ');
  field('location').value = post.location?.label || '';
  field('pinned').checked = post.pinned;
  archive.hidden = post.status === 'archived';
  publish.disabled = Boolean(post.deletedAt);
  publish.textContent = post.status === 'published' ? '已发布' : '发布';
  withdraw.hidden = post.status !== 'published' || Boolean(post.deletedAt);
  live.hidden = post.status !== 'published';
  live.href = post.canonicalPath;
  dirty = false;
  history.replaceState(null, '', '?id=' + encodeURIComponent(id));
}
function payload() {
  return {
    id,
    revision,
    kind: field('kind').value,
    title: field('title').value,
    body: field('body').value,
    excerpt: field('excerpt').value,
    tags: field('tags')
      .value.split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean),
    location: field('location').value,
    pinned: field('pinned').checked,
  };
}
async function run(action: () => Promise<void>) {
  if (busy) return;
  busy = true;
  fieldset.disabled = true;
  try {
    await action();
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : '操作失败，请重试。';
  } finally {
    fieldset.disabled = false;
    busy = false;
  }
}
form.addEventListener('input', () => {
  dirty = true;
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  void run(async () => {
    status.textContent = '正在保存…';
    loaded(await request('/api/admin/posts', payload()));
    status.textContent =
      current?.status === 'published'
        ? '已保存，该版本已上线。'
        : current?.status === 'archived'
          ? '归档内容已保存。'
          : '草稿已保存。';
  });
});
publish.addEventListener('click', () => {
  void run(async () => {
    if (!revision || dirty)
      loaded(await request('/api/admin/posts', payload()));
    if (current?.status === 'published') {
      status.textContent = '该内容已发布；修改后保存即可更新。';
      return;
    }
    status.textContent = '正在发布…';
    loaded(await request('/api/admin/posts/' + id + '/publish', { revision }));
    status.textContent = '发布成功，该版本已上线。';
  });
});
withdraw.addEventListener('click', () => {
  if (!confirm('撤回后读者无法查看该内容，确认撤回为草稿？')) return;
  void run(async () => {
    if (dirty) throw Error('请先保存当前修改。');
    loaded(await request('/api/admin/posts/' + id + '/withdraw', { revision }));
    status.textContent = '已撤回为草稿，公开链接不再展示正文。';
  });
});
document.querySelector('#editor-preview')!.addEventListener('click', () => {
  void run(async () => {
    const data = await request('/api/admin/preview', {
      body: field('body').value,
    });
    preview.innerHTML = data.html;
    preview.hidden = false;
    status.textContent = '正文预览，尚未保存本次修改。';
  });
});
window.addEventListener('beforeunload', (event) => {
  if (dirty) {
    event.preventDefault();
  }
});
(async () => {
  try {
    await request('/api/admin/posts');
    if (new URLSearchParams(location.search).has('id'))
      loaded(await request('/api/admin/posts/' + encodeURIComponent(id)));
    fieldset.disabled = false;
    publish.disabled = Boolean(current?.deletedAt);
    status.textContent = revision
      ? current?.deletedAt
        ? '内容在回收站，可以查看或恢复为草稿。'
        : current?.status === 'published'
          ? '已载入已发布内容；保存修改会立即更新公开页面。'
          : '已载入内容。'
      : '身份已确认，可以开始写文。';
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : '登录验证失败。';
  }
})();

archive.addEventListener('click', () => {
  if (!confirm('归档后内容不会公开；保存的文字仍保留，确认归档？')) return;
  void run(async () => {
    if (dirty) throw Error('请先保存当前修改。');
    loaded(await request('/api/admin/posts/' + id + '/archive', { revision }));
    status.textContent = '内容已归档，文字仍保留。';
  });
});

document.querySelector('#editor-delete')!.addEventListener('click', () => {
  if (
    !confirm(
      '删除后移入回收站，公开页面不再可读，可以恢复为草稿。未保存修改不会保留。确认删除？',
    )
  )
    return;
  void run(async () => {
    if (!revision) throw Error('请先保存内容。');
    loaded(
      await request('/api/admin/posts/' + id + '/delete', {
        revision,
        confirm: true,
      }),
    );
    status.textContent = '已移入回收站，请恢复后再编辑或发布。';
  });
});
document.querySelector('#editor-restore')!.addEventListener(
  'click',
  () =>
    void run(async () => {
      loaded(
        await request('/api/admin/posts/' + id + '/restore', { revision }),
      );
      status.textContent = '已恢复为草稿，需要重新发布才能公开。';
    }),
);
