export const normalizeCopy = (text: string) => text.replace(/\s+/g, ' ').trim();
export function createCopyTranslator(overrides: Record<string, string>) {
  const exact = new Map<string, string>();
  const patterns: { regex: RegExp; replacement: string; ids: string[] }[] = [];
  for (const [original, replacement] of Object.entries(overrides)) {
    if (original === replacement) continue;
    if (!/\{\d+\}/.test(original))
      exact.set(normalizeCopy(original), replacement);
    else {
      const ids: string[] = [];
      const parts = original.split(/(\{\d+\})/g).map((part) => {
        if (/^\{\d+\}$/.test(part)) {
          ids.push(part);
          return '([\\s\\S]*?)';
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      });
      patterns.push({
        regex: new RegExp('^' + parts.join('') + '$'),
        replacement,
        ids,
      });
    }
  }
  return (text: string) => {
    const normalized = normalizeCopy(text);
    let translated = exact.get(normalized);
    if (translated === undefined)
      for (const pattern of patterns) {
        const match = normalized.match(pattern.regex);
        if (match) {
          const values = new Map(
            pattern.ids.map((id, i) => [id, match[i + 1]]),
          );
          translated = pattern.replacement.replace(
            /\{\d+\}/g,
            (id) => values.get(id) || '',
          );
          break;
        }
      }
    if (translated === undefined) return text;
    return (
      (text.match(/^\s*/)?.[0] || '') +
      translated +
      (text.match(/\s*$/)?.[0] || '')
    );
  };
}
export const copyProtectedSelector =
  'script,style,textarea,code,pre,time,[data-copy-skip],[data-user-content],[data-site-title],[data-profile-name],[data-profile-bio],[data-profile-location],.post-title,.post-body,.tags,.post-location,.copy-original,#image-caption';
let pageCopy: ReturnType<typeof createCopyTranslator> | undefined;
export function interfaceCopy(text: string) {
  if (typeof document === 'undefined') return text;
  if (!pageCopy) {
    let config: { overrides?: Record<string, string>; includeAdmin?: boolean } =
      {};
    try {
      config = JSON.parse(
        document.querySelector('#site-copy-config')?.textContent || '{}',
      );
    } catch {}
    pageCopy = createCopyTranslator(
      location.pathname.startsWith('/admin/') && !config.includeAdmin
        ? {}
        : config.overrides || {},
    );
  }
  return pageCopy(text);
}
