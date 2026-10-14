import { adminRequest } from './admin-request';
interface Entry {
  id: string;
  text: string;
  groups: string[];
}
const form = document.querySelector<HTMLFormElement>('#copy-form')!;
const fieldset = form.querySelector<HTMLFieldSetElement>('fieldset')!;
const status = document.querySelector<HTMLElement>('#copy-status')!;
const list = document.querySelector<HTMLElement>('#copy-list')!;
const query = document.querySelector<HTMLInputElement>('#copy-query')!;
const group = document.querySelector<HTMLSelectElement>('#copy-group')!;
const more = document.querySelector<HTMLButtonElement>('#copy-more')!;
const title = form.elements.namedItem('siteTitle') as HTMLInputElement;
const includeAdmin = form.elements.namedItem(
  'includeAdmin',
) as HTMLInputElement;
let catalog: Entry[] = [],
  values = new Map<string, string>(),
  revision = 0,
  limit = 40,
  dirty = false,
  busy = false;
function render() {
  const text = query.value.trim().toLowerCase();
  const filtered = catalog.filter(
    (e) =>
      (!group.value || e.groups.includes(group.value)) &&
      (!text ||
        (e.text + ' ' + (values.get(e.id) || '')).toLowerCase().includes(text)),
  );
  list.replaceChildren();
  for (const entry of filtered.slice(0, limit)) {
    const section = document.createElement('section'),
      label = document.createElement('label'),
      original = document.createElement('div'),
      input = document.createElement('textarea'),
      reset = document.createElement('button'),
      hint = document.createElement('small');
    section.className = 'copy-entry';
    original.className = 'copy-original';
    original.setAttribute('data-copy-skip', '');
    original.textContent = entry.text;
    hint.textContent = entry.groups.join(' / ');
    input.rows = entry.text.length > 100 ? 4 : 2;
    input.maxLength = 4000;
    input.value = values.get(entry.id) ?? entry.text;
    input.setAttribute('aria-label', '修改文案：' + entry.text.slice(0, 80));
    input.addEventListener('input', () => {
      values.set(entry.id, input.value);
      dirty = true;
    });
    reset.type = 'button';
    reset.textContent = '恢复这一项';
    reset.addEventListener('click', () => {
      values.delete(entry.id);
      input.value = entry.text;
      dirty = true;
    });
    label.textContent = '修改后的文字';
    label.append(input);
    section.append(hint, original, label, reset);
    list.append(section);
  }
  more.hidden = filtered.length <= limit;
}
query.addEventListener('input', () => {
  limit = 40;
  render();
});
group.addEventListener('change', () => {
  limit = 40;
  render();
});
more.addEventListener('click', () => {
  limit += 40;
  render();
});
form.addEventListener('input', () => {
  dirty = true;
});
document.querySelector('#copy-reset')!.addEventListener('click', () => {
  if (confirm('恢复所有网站文案与站名为默认值？需再点击保存才会生效。')) {
    values.clear();
    title.value = 'SFSafi 的个人空间';
    includeAdmin.checked = false;
    dirty = true;
    render();
  }
});
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  fieldset.disabled = true;
  status.textContent = '正在保存文案…';
  const overrides: Record<string, string> = {};
  for (const entry of catalog) {
    const value = values.get(entry.id);
    if (value !== undefined && value !== entry.text)
      overrides[entry.id] = value;
  }
  try {
    const data = await adminRequest('/api/admin/site-copy', {
      revision,
      siteTitle: title.value,
      includeAdmin: includeAdmin.checked,
      overrides,
    });
    revision = data.revision;
    values = new Map(Object.entries(data.settings.overrides));
    dirty = false;
    status.textContent = '文案已保存，打开或刷新网站即可看到。';
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : '保存失败。';
  } finally {
    busy = false;
    fieldset.disabled = false;
  }
});
window.addEventListener('beforeunload', (event) => {
  if (dirty) event.preventDefault();
});
void (async () => {
  try {
    const data = await adminRequest('/api/admin/site-copy');
    catalog = data.catalog;
    revision = data.revision;
    values = new Map(Object.entries(data.settings.overrides));
    title.value = data.settings.siteTitle;
    includeAdmin.checked = data.settings.includeAdmin;
    render();
    fieldset.disabled = false;
    status.textContent = '已载入文案。未修改的项目继续使用默认值。';
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : '载入失败。';
  }
})();
