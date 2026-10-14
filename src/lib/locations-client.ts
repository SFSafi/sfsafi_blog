interface Place {
  postId: string;
  title: string;
  path: string;
  label: string | null;
}
async function refreshLocations() {
  try {
    const directory = document.querySelector<HTMLElement>(
      '[data-location-directory]',
    );
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>('[data-location-post]'),
    );
    if (!directory && !cards.length) return;
    const ids = cards.map((card) => card.dataset.locationPost!);
    const response = await fetch(
      '/api/post-locations' +
        (directory ? '' : `?ids=${ids.map(encodeURIComponent).join(',')}`),
      { cache: 'no-store', signal: AbortSignal.timeout(10000) },
    );
    if (!response.ok) return;
    const posts: Place[] = await response.json();
    for (const post of posts) {
      for (const card of cards.filter(
        (c) => c.dataset.locationPost === post.postId,
      )) {
        const anchor = card.querySelector<HTMLAnchorElement>(
          '[data-location-link]',
        )!;
        anchor.hidden = !post.label;
        anchor.textContent = post.label ? '⌖ ' + post.label : '';
        anchor.href = `/locations/?place=${encodeURIComponent(post.label || '')}`;
        const share = card.querySelector<HTMLElement>('[data-share]');
        if (share) share.dataset.shareLocation = post.label || '';
      }
    }
    if (directory) {
      const selected = new URLSearchParams(location.search).get('place');
      directory.replaceChildren();
      if (selected) {
        const list = posts.filter((post) => post.label === selected);
        for (const post of list) {
          const link = document.createElement('a');
          const title = document.createElement('h2');
          title.setAttribute('data-user-content', '');
          title.textContent = post.title;
          const label = document.createElement('small');
          label.textContent = selected;
          link.href = post.path;
          link.append(title, label);
          directory.append(link);
        }
        if (!list.length) directory.textContent = '这个地点暂时没有公开记录。';
      } else {
        for (const label of [
          ...new Set(
            posts
              .map((post) => post.label)
              .filter((label): label is string => !!label),
          ),
        ]) {
          const link = document.createElement('a');
          link.href = `/locations/?place=${encodeURIComponent(label)}`;
          const title = document.createElement('h2');
          title.setAttribute('data-user-content', '');
          title.textContent = label;
          const count = document.createElement('small');
          count.textContent = `${posts.filter((post) => post.label === label).length} 条记录`;
          link.append(title, count);
          directory.append(link);
        }
        if (!directory.childElementCount)
          directory.textContent = '还没有添加地点。';
      }
    }
  } catch {}
}
export const locationsReady = refreshLocations();
