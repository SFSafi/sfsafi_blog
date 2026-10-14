const card = document.querySelector<HTMLElement>('[data-reading]');
const body = card?.querySelector<HTMLElement>('.post-body');
const progress = document.querySelector<HTMLProgressElement>(
  '[data-reading-progress]',
);
if (card && body && progress) {
  progress.hidden = false;
  const top = document.querySelector<HTMLButtonElement>('[data-reading-top]');
  const links = Array.from(
    card.querySelectorAll<HTMLAnchorElement>('.article-toc a'),
  );
  const headings = links.map((link) =>
    document.getElementById(link.hash.slice(1)),
  );
  let scheduled = false;
  function update() {
    scheduled = false;
    const rect = body!.getBoundingClientRect();
    const value = Math.max(
      0,
      Math.min(
        100,
        (-rect.top / Math.max(1, rect.height - innerHeight * 0.7)) * 100,
      ),
    );
    progress!.value = Math.round(value);
    if (top) top.hidden = scrollY < 600;
    let active = 0;
    headings.forEach((heading, i) => {
      if (heading && heading.getBoundingClientRect().top < innerHeight * 0.3)
        active = i;
    });
    links.forEach((link, i) =>
      i === active
        ? link.setAttribute('aria-current', 'location')
        : link.removeAttribute('aria-current'),
    );
  }
  const schedule = () => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(update);
    }
  };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  new ResizeObserver(schedule).observe(body);
  top?.addEventListener('click', () =>
    card.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
      block: 'start',
    }),
  );
  update();
}
