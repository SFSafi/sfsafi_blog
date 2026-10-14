import { createCopyTranslator, copyProtectedSelector } from './copy-text';
const config = document.querySelector('#site-copy-config');
if (config) {
  let settings: { overrides?: Record<string, string>; includeAdmin?: boolean } =
    {};
  try {
    settings = JSON.parse(config.textContent || '{}');
  } catch {}
  if (
    settings.overrides &&
    Object.keys(settings.overrides).length > 0 &&
    (settings.includeAdmin || !location.pathname.startsWith('/admin/'))
  ) {
    const translate = createCopyTranslator(settings.overrides);
    const confirm = window.confirm.bind(window);
    window.confirm = (message) => confirm(translate(String(message || '')));
    const last = new WeakMap<Node, string>();
    const update = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (
          node.parentElement?.closest(copyProtectedSelector) ||
          last.get(node) === node.nodeValue
        )
          return;
        const old = node.nodeValue || '';
        const value = translate(old);
        if (value !== old) {
          last.set(node, value);
          node.nodeValue = value;
        }
      } else if (node instanceof Element) {
        if (
          node.matches(copyProtectedSelector) ||
          node.closest('[data-copy-skip],[data-user-content]')
        )
          return;
        for (const name of ['placeholder', 'aria-label', 'title']) {
          const value = node.getAttribute(name);
          if (value !== null) {
            const next = translate(value);
            if (next !== value) node.setAttribute(name, next);
          }
        }
        for (const child of node.childNodes) update(child);
      }
    };
    update(document.body);
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'characterData') update(record.target);
        else for (const node of record.addedNodes) update(node);
      }
    }).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }
}
