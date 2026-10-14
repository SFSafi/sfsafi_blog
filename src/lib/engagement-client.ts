export {};
interface Stats {
  postId: string;
  views: number;
  likes: number;
  dislikes: number;
  myVote: -1 | 0 | 1;
  comments: number;
}
const sections = Array.from(
  document.querySelectorAll<HTMLElement>('[data-engagement]'),
);
const states = new Map<string, Stats>();
const pending = new Set<string>();
const viewed = new Set<string>();
const formatter = new Intl.NumberFormat('zh-CN');
function setStatus(id: string, message: string, retry = false) {
  for (const section of sections.filter((s) => s.dataset.postId === id)) {
    section.querySelector<HTMLElement>('[data-status]')!.textContent = message;
    section.querySelector<HTMLButtonElement>('[data-stats-retry]')!.hidden =
      !retry;
  }
}
function render(value: Stats) {
  states.set(value.postId, value);
  for (const section of sections.filter(
    (s) => s.dataset.postId === value.postId,
  )) {
    section.querySelector('[data-views]')!.textContent = formatter.format(
      value.views,
    );
    section.querySelector('[data-likes]')!.textContent = formatter.format(
      value.likes,
    );
    section.querySelector('[data-dislikes]')!.textContent = formatter.format(
      value.dislikes,
    );
    const comments = section.querySelector('[data-comment-count]');
    if (comments) comments.textContent = formatter.format(value.comments || 0);
    for (const button of section.querySelectorAll<HTMLButtonElement>(
      '[data-vote]',
    )) {
      button.setAttribute(
        'aria-pressed',
        String(Number(button.dataset.vote) === value.myVote),
      );
      button.disabled = pending.has(value.postId);
    }
  }
}
async function request(path: string, body?: unknown) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
    ...(body !== undefined
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error('操作太频繁，请稍后重试。');
    throw new Error(
      response.status === 503
        ? '统计暂不可用，请稍后重试。'
        : '加载失败，请重试。',
    );
  }
  return response.json();
}
async function recordView(id: string) {
  if (viewed.has(id) || document.visibilityState !== 'visible') return;
  if (pending.has(id)) return;
  viewed.add(id);
  pending.add(id);
  render(states.get(id)!);
  try {
    const result = await request(
      `/api/engagement/${encodeURIComponent(id)}/view`,
      {},
    );
    render(result);
    setStatus(id, '');
  } catch (error) {
    viewed.delete(id);
    setStatus(
      id,
      error instanceof Error ? error.message : '阅览记录失败，请重试。',
      true,
    );
  } finally {
    pending.delete(id);
    render(states.get(id)!);
  }
}
let loading = false;
async function load() {
  if (loading) return;
  loading = true;
  for (const section of sections)
    setStatus(section.dataset.postId!, '正在加载统计…');
  try {
    const ids = [...new Set(sections.map((s) => s.dataset.postId!))];
    if (!ids.length) return;
    const result: Stats[] = await request(
      `/api/engagement?ids=${ids.map(encodeURIComponent).join(',')}`,
    );
    for (const item of result) {
      render(item);
      setStatus(item.postId, '');
    }
    for (const section of sections.filter((s) => s.dataset.detail === 'true'))
      await recordView(section.dataset.postId!);
  } catch (error) {
    for (const section of sections)
      setStatus(
        section.dataset.postId!,
        error instanceof Error ? error.message : '加载失败，请重试。',
        true,
      );
  } finally {
    loading = false;
  }
}
for (const section of sections) {
  const id = section.dataset.postId!;
  section
    .querySelector('[data-stats-retry]')!
    .addEventListener('click', () => void load());
  for (const button of section.querySelectorAll<HTMLButtonElement>(
    '[data-vote]',
  ))
    button.addEventListener('click', async () => {
      const current = states.get(id);
      if (!current || pending.has(id)) return;
      const choice = Number(button.dataset.vote);
      pending.add(id);
      render(current);
      setStatus(id, '正在提交…');
      try {
        const result: Stats = await request(
          `/api/engagement/${encodeURIComponent(id)}/vote`,
          { vote: current.myVote === choice ? 0 : choice },
        );
        render(result);
        setStatus(id, result.myVote === 0 ? '已取消评价。' : '评价已保存。');
      } catch (error) {
        setStatus(
          id,
          error instanceof Error ? error.message : '提交失败，请重试。',
          true,
        );
      } finally {
        pending.delete(id);
        render(states.get(id)!);
      }
    });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible')
    for (const section of sections.filter(
      (s) => s.dataset.detail === 'true' && states.has(s.dataset.postId!),
    ))
      void recordView(section.dataset.postId!);
});
void load();
document.addEventListener('comments-updated', () => void load());
