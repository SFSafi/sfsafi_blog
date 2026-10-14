import { adminRequest } from './admin-request';
const form = document.querySelector<HTMLFormElement>('#posts-filter')!;
const state = document.querySelector<HTMLSelectElement>(
  '#posts-filter-status',
)!;
const query = document.querySelector<HTMLInputElement>('#posts-query')!;
const list = document.querySelector<HTMLElement>('#posts-list')!;
const status = document.querySelector<HTMLElement>('#posts-status')!;
const more = document.querySelector<HTMLButtonElement>('#posts-more')!;
let page = 1,
  busy = false;
const initial = new URLSearchParams(location.search);
state.value = ['all', 'published', 'draft', 'archived', 'trash'].includes(
  initial.get('status') || '',
)
  ? initial.get('status')!
  : 'all';
query.value = initial.get('query') || '';
async function load(reset = false) {
  if (busy) return;
  busy = true;
  more.disabled = true;
  state.disabled = true;
  if (reset) {
    page = 1;
    list.replaceChildren();
  }
  try {
    const params = new URLSearchParams({
      page: String(page),
      status: state.value,
      query: query.value,
    });
    const data = await adminRequest('/api/admin/posts?' + params);
    if (page === 1) list.replaceChildren();
    history.replaceState(
      null,
      '',
      '?' +
        new URLSearchParams({
          status: state.value,
          ...(query.value ? { query: query.value } : {}),
        }),
    );
    for (const post of data.items) {
      const item = document.createElement('article'),
        heading = document.createElement('h2'),
        meta = document.createElement('p'),
        actions = document.createElement('div'),
        edit = document.createElement('a');
      item.className = 'admin-post-row';
      heading.setAttribute('data-user-content', '');
      heading.textContent = post.title || '未命名';
      meta.textContent =
        (post.deletedAt
          ? '回收站'
          : post.status === 'published'
            ? '已发布'
            : post.status === 'archived'
              ? '已归档'
              : '草稿') +
        ' · ' +
        new Date(post.updatedAt).toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai',
        });
      actions.className = 'admin-post-actions';
      edit.href = '/admin/write/?id=' + encodeURIComponent(post.id);
      edit.textContent = post.deletedAt ? '查看内容' : '编辑';
      actions.append(edit);
      if (post.status === 'published' && !post.deletedAt) {
        const view = document.createElement('a');
        view.href = post.canonicalPath;
        view.target = '_blank';
        view.rel = 'noopener';
        view.textContent = '查看公开页面 ↗';
        actions.append(view);
      }
      const entries = post.deletedAt
        ? [['restore', '恢复为草稿']]
        : [
            ...(post.status === 'published'
              ? [['withdraw', '撤回为草稿']]
              : [['publish', '发布']]),
            ['delete', '删除'],
          ];
      for (const [action, label] of entries) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        if (action === 'delete') button.className = 'danger';
        button.addEventListener('click', async () => {
          if (busy) return;
          if (
            action === 'delete' &&
            !confirm(
              `删除“${post.title || '这篇内容'}”？将移入回收站，公开链接不再可读，可以恢复为草稿。`,
            )
          )
            return;
          if (
            action === 'withdraw' &&
            !confirm('撤回后公开页面不再可读，确认撤回？')
          )
            return;
          busy = true;
          button.disabled = true;
          try {
            await adminRequest('/api/admin/posts/' + post.id + '/' + action, {
              revision: post.revision,
              ...(action === 'delete' ? { confirm: true } : {}),
            });
            busy = false;
            await load(true);
            status.textContent =
              action === 'delete'
                ? '已移入回收站。'
                : action === 'restore'
                  ? '已恢复为草稿；需要重新发布才能公开。'
                  : '内容状态已更新。';
          } catch (error) {
            status.textContent =
              error instanceof Error ? error.message : '操作失败。';
          } finally {
            busy = false;
            button.disabled = false;
          }
        });
        actions.append(button);
      }
      item.append(heading, meta, actions);
      list.append(item);
    }
    more.hidden = !data.hasMore;
    page++;
    status.textContent = data.items.length
      ? '已载入内容。'
      : '没有符合条件的内容。';
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : '读取失败。';
  } finally {
    busy = false;
    more.disabled = false;
    state.disabled = false;
  }
}
form.addEventListener('submit', (event) => {
  event.preventDefault();
  void load(true);
});
state.addEventListener('change', () => void load(true));
more.addEventListener('click', () => void load());
void load();
