import type { Post } from './content';
export interface WritingArchive {
  format: 'sfsafi-writing-archive';
  version: 1;
  createdAt: string;
  posts: Post[];
}
export function restoreFields(post: Post) {
  if (
    !post ||
    !['article', 'note'].includes(post.kind) ||
    typeof post.body !== 'string' ||
    !post.body.trim() ||
    Array.from(post.body).length > 20000 ||
    !['plain', 'markdown'].includes(post.bodyFormat) ||
    (post.title !== undefined &&
      (typeof post.title !== 'string' ||
        Array.from(post.title).length > 120)) ||
    (post.kind === 'article' && !post.title?.trim()) ||
    (post.excerpt !== undefined &&
      (typeof post.excerpt !== 'string' ||
        Array.from(post.excerpt).length > 300)) ||
    !Array.isArray(post.tags) ||
    post.tags.length > 8 ||
    post.tags.some(
      (t) => typeof t !== 'string' || !t.trim() || Array.from(t).length > 30,
    ) ||
    (post.location &&
      (typeof post.location.label !== 'string' ||
        Array.from(post.location.label).length > 80))
  )
    throw Error('备份中存在无效的文章字段，请检查文件。');
  return {
    kind: post.kind,
    title: post.title || '',
    body: post.body,
    bodyFormat: post.bodyFormat,
    excerpt: post.excerpt || '',
    tags: post.tags,
    location: post.location?.label || '',
    pinned: false,
  };
}
export function parseWritingArchive(text: string): WritingArchive {
  const value = JSON.parse(text);
  if (
    !value ||
    value.format !== 'sfsafi-writing-archive' ||
    value.version !== 1 ||
    typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !Array.isArray(value.posts) ||
    value.posts.length > 5000
  )
    throw Error('请选择本站导出的版本 1 写作备份。');
  for (const post of value.posts) restoreFields(post);
  return value;
}
