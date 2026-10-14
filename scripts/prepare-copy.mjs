import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { parseFragment } from 'parse5';

const entries = new Map();
const normalize = (text) => text.replace(/\s+/g, ' ').trim();
const dynamic = '__COPY_DYNAMIC_';
const protectedClasses = new Set([
  'post-title',
  'post-body',
  'tags',
  'post-location',
  'copy-original',
]);
function protectedNode(node) {
  const attrs = Object.fromEntries(
    (node.attrs || []).map((a) => [a.name, a.value]),
  );
  return (
    ['script', 'style', 'textarea', 'code', 'pre', 'title'].includes(
      node.tagName,
    ) ||
    Object.keys(attrs).some(
      (k) =>
        k === 'data-user-content' ||
        k === 'data-site-title' ||
        k === 'data-copy-skip' ||
        k.startsWith('data-profile-'),
    ) ||
    (attrs.class || '').split(/\s+/).some((c) => protectedClasses.has(c)) ||
    node.tagName === 'time'
  );
}
function add(text, group) {
  text = normalize(text);
  if (
    !text ||
    text.length > 4000 ||
    (!/[\p{L}]/u.test(text) && !text.includes('©')) ||
    text.includes('${') ||
    (/[{}]/.test(text) && !/__COPY_DYNAMIC_\d+__/.test(text))
  )
    return;
  let n = 0;
  text = text.replace(/__COPY_DYNAMIC_\d+__/g, () => `{${n++}}`);
  // A placeholder alone is user data, never a global interface label.
  if (!/[\p{L}©]/u.test(text.replace(/\{\d+\}/g, ''))) return;
  if (!text || text.includes(dynamic)) return;
  const id = createHash('sha256').update(text).digest('hex').slice(0, 20);
  const old = entries.get(id);
  if (old) {
    if (!old.groups.includes(group)) old.groups.push(group);
  } else entries.set(id, { id, text, groups: [group] });
}
function collectHtml(html, group, isContent = false) {
  const tree = parseFragment(html);
  const walk = (node, skip = false) => {
    skip ||= protectedNode(node);
    if (!skip && node.nodeName === '#text') add(node.value, group);
    if (!skip)
      for (const a of node.attrs || []) {
        if (['placeholder', 'aria-label', 'title'].includes(a.name))
          add(a.value, group);
        if (
          !isContent &&
          a.name === 'content' &&
          (node.attrs || []).some(
            (v) => v.name === 'name' && v.value === 'description',
          )
        )
          add(a.value, group);
      }
    for (const child of node.childNodes || [])
      walk(
        child,
        skip || (isContent && ['title', 'h1', 'h2'].includes(node.tagName)),
      );
  };
  walk(tree);
}
function walkFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walkFiles(join(dir, d.name)) : [join(dir, d.name)],
  );
}
function collectCode(source, path) {
  const group =
    /admin|backup|editor-client|media-client|posts-client|site-settings|posts\.ts|owner\.ts|site-copy\.ts|worker\/(profile|locations|notifications|media)\.ts/i.test(
      path,
    )
      ? '管理界面'
      : '提示与交互';
  const ast = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const collect = (text) => {
    if (text.includes('<') && text.includes('>')) collectHtml(text, group);
    else if (/[\u3400-\u9fff]/.test(text) || /^[A-Z][A-Z\s,.]+$/.test(text))
      add(text, group);
  };
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      collect(node.text);
    else if (ts.isTemplateExpression(node)) {
      let text = node.head.text;
      node.templateSpans.forEach((s, i) => {
        text += `${dynamic}${i}__` + s.literal.text;
      });
      collect(text);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      let i = 0;
      const flatten = (n) =>
        ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)
          ? n.text
          : ts.isBinaryExpression(n) &&
              n.operatorToken.kind === ts.SyntaxKind.PlusToken
            ? flatten(n.left) + flatten(n.right)
            : `${dynamic}${i++}__`;
      const text = flatten(node);
      if (text.length < 4000) collect(text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}
for (const path of [...walkFiles('src'), ...walkFiles('worker')]) {
  if (
    path.includes('/generated/') ||
    /content\.ts$|copy-catalog\.json$|comment-mail\.ts$/.test(path)
  )
    continue;
  if (path.endsWith('.ts')) collectCode(readFileSync(path, 'utf8'), path);
  else if (path.endsWith('.astro')) {
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))
      collectCode(match[1], path);
    const matter = source.match(/^---\n([\s\S]*?)\n---/);
    if (matter) collectCode(matter[1], path);
  }
}
if (existsSync('dist'))
  for (const path of walkFiles('dist').filter((p) => p.endsWith('.html'))) {
    const file = relative('dist', path);
    collectHtml(
      readFileSync(path, 'utf8'),
      file.startsWith('admin/') ? '管理界面' : '读者界面',
      /^(posts\/|tags\/[^i]|locations\/[^i])/.test(file),
    );
  }
const result = [...entries.values()].sort((a, b) =>
  a.text.localeCompare(b.text, 'zh-CN'),
);
writeFileSync(
  'src/lib/copy-catalog.json',
  JSON.stringify(result, null, 2) + '\n',
);
console.log(`Prepared ${result.length} editable interface texts`);
