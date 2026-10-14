import { Marked, Renderer } from 'marked';
import { escapeHtml, plainText } from './text';
export interface ArticleHeading {
  id: string;
  text: string;
  depth: number;
}
function createParser(headings?: ArticleHeading[]) {
  const renderer = new Renderer();
  renderer.html = ({ text }) => escapeHtml(text);
  renderer.image = ({ text }) => escapeHtml(text);
  renderer.link = function ({ href, tokens }) {
    let safe = false;
    try {
      safe = ['https:', 'http:', 'mailto:'].includes(
        new URL(href, 'https://site.invalid').protocol,
      );
    } catch {}
    const text = this.parser.parseInline(tokens);
    return safe
      ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${text}</a>`
      : text;
  };
  if (headings)
    renderer.heading = function ({ text, depth, tokens }) {
      const id = 'content-heading-' + (headings.length + 1);
      headings.push({ id, text: plainText(text), depth });
      return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
    };
  return new Marked({ renderer, gfm: true, breaks: true, async: false });
}
const parser = createParser();
export const markdown = (body: string) =>
  parser.parse(body, { async: false }) as string;
export function markdownDocument(body: string) {
  const headings: ArticleHeading[] = [];
  const html = createParser(headings).parse(body, { async: false }) as string;
  return { html, headings };
}
