import { Lexer } from 'marked';
export const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
export function plainText(body: string) {
  interface TextToken {
    type: string;
    text?: string;
    tokens?: TextToken[];
    items?: TextToken[];
    header?: { tokens: TextToken[] }[];
    rows?: { tokens: TextToken[] }[][];
  }
  const text = (token: TextToken): string => {
    if (token.type === 'br' || token.type === 'space') return ' ';
    if (token.type === 'html')
      return (token.text || '').replace(/<[^>]*>/g, '');
    if (token.type === 'table')
      return [...(token.header || []), ...(token.rows || []).flat()]
        .map((cell) => cell.tokens.map(text).join(''))
        .join(' ');
    if (token.items) return token.items.map(text).join(' ');
    if (token.tokens) return token.tokens.map(text).join('');
    return token.text || '';
  };
  return (Lexer.lex(body) as TextToken[])
    .map(text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
export function contentText(post: {
  body: string;
  bodyFormat: 'plain' | 'markdown';
}) {
  return post.bodyFormat === 'markdown'
    ? plainText(post.body)
    : post.body.replace(/\s+/g, ' ').trim();
}
export function readingStats(body: string) {
  const text = plainText(body),
    characters = Array.from(text.replace(/\s/g, '')).length;
  const chinese = (text.match(/[\p{Script=Han}]/gu) || []).length;
  const words = (
    text.replace(/[\p{Script=Han}]/gu, ' ').match(/[\p{L}\p{N}]+/gu) || []
  ).length;
  return {
    characters,
    minutes: Math.max(1, Math.ceil(chinese / 350 + words / 200)),
  };
}
