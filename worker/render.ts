import type { D1Database } from '@cloudflare/workers-types';
import { type Post, formatDate } from '../src/lib/content';
import { contentRepository } from './content-repository';
import { markdownDocument } from '../src/lib/markdown';
export { markdown } from '../src/lib/markdown';
import { escapeHtml, contentText, readingStats } from '../src/lib/text';
import { siteOrigin, type SiteConfig } from '../src/lib/site';
import { publicProfile } from './profile';
import type { OwnerEnv } from './owner';
export const escape = escapeHtml;
function media(post: Post) {
  if (!post.media.length) return '';
  return `<div class="media-grid ${post.media.length === 1 ? 'single' : ''}" data-gallery data-image-count="${post.media.filter((m) => m.kind === 'image').length}">${post.media.map((m) => (m.kind === 'image' ? `<div class="image-wrap"><button class="image-button" data-image data-src="${escape(m.storageKey)}" data-alt="${escape(m.alt)}" aria-label="查看完整图片：${escape(m.alt)}"><img data-media-image src="${escape(m.storageKey)}" alt="${escape(m.alt)}" width="${m.width}" height="${m.height}" loading="lazy"></button><p class="media-error" hidden>图片暂时无法加载。<a href="${escape(m.storageKey)}">重试打开原图 ↗</a></p></div>` : `<div class="video-wrap"><video controls playsinline preload="none" poster="${escape(m.thumbnailKey)}" style="aspect-ratio:${m.width}/${m.height}" aria-label="${escape(m.alt)}"><source src="${escape(m.storageKey)}" type="${escape(m.mimeType)}"><track kind="captions" src="/media/flower.vtt" srclang="zh" label="中文描述">你的浏览器不支持视频播放。</video><p class="video-error" hidden>视频加载失败。<button data-retry>重试</button></p></div>`)).join('')}</div>`;
}
export function card(post: Post, detail = false) {
  const preview = detail
    ? ''
    : post.excerpt || contentText({ ...post, body: post.body.slice(0, 1200) });
  const body = detail
    ? post.body
    : preview.slice(0, 280) + (preview.length > 280 ? '…' : '');
  const document =
    detail && post.bodyFormat === 'markdown'
      ? markdownDocument(body)
      : undefined;
  const paragraphs = document
    ? document.html
    : body
        .split('\n\n')
        .map((t) => `<p>${escape(t)}</p>`)
        .join('');
  const reading = detail && post.kind === 'article';
  const stats = reading
    ? readingStats(post.body)
    : { minutes: 0, characters: 0 };
  const tools = reading
    ? `<div class="reading-meta">约 ${stats.minutes} 分钟 · ${stats.characters.toLocaleString('zh-CN')} 字</div>${document && document.headings.length > 1 ? `<details class="article-toc" open><summary>本文目录</summary><ol data-user-content>${document.headings.map((h) => `<li style="--heading-depth:${Math.min(h.depth - 1, 3)}"><a href="#${h.id}">${escape(h.text)}</a></li>`).join('')}</ol></details>` : ''}<progress class="reading-progress" data-reading-progress max="100" value="0" aria-label="阅读进度" hidden></progress><button class="reading-top" type="button" data-reading-top hidden>↑ 回到开头</button>`
    : '';
  return `<article class="post-card ${post.pinned ? 'pinned' : ''} ${detail ? 'detail-card' : 'feed-card'}" ${reading ? 'data-reading' : ''} data-location-post="${escape(post.id)}" data-post-revision="${post.revision}">
 ${post.sample ? '<p class="muted sample-label">示例内容</p>' : ''}
 ${post.pinned ? '<div class="pin-label">⌁ 置顶 · 从这里开始</div>' : ''}
 <div class="post-meta"><img src="/media/avatar.svg" width="36" height="36" alt="" data-profile-avatar><div><strong data-profile-name>SFSafi</strong><span><time datetime="${escape(post.firstPublishedAt)}">${formatDate(post.firstPublishedAt!)}</time> · ${post.kind === 'article' ? '文章' : '动态'}</span></div><a class="post-permalink" href="${escape(post.canonicalPath)}" aria-label="打开这条内容的稳定链接">↗</a></div>
 ${post.title ? `<h2 class="post-title"><a href="${escape(post.canonicalPath)}">${escape(post.title)}</a></h2>` : ''}${tools}<div class="post-body">${paragraphs}</div>${media(post)}
 <a class="post-location" data-location-link href="/locations/?place=${encodeURIComponent(post.location?.label || '')}" ${post.location ? '' : 'hidden'}>⌖ ${escape(post.location?.label)}</a>
 <div class="post-bottom"><div class="tags">${post.tags.map((t) => `<a href="/tags/${encodeURIComponent(t)}/"># ${escape(t)}</a>`).join('')}</div>${!detail ? `<a class="read-more" href="${escape(post.canonicalPath)}">${post.kind === 'article' ? '阅读全文' : '查看动态'} →</a>` : ''}</div>
 ${detail && post.updatedAt !== post.firstPublishedAt ? `<p class="muted">更新于 ${formatDate(post.updatedAt)}</p>` : ''}
 <div class="post-tools"><section class="engagement" data-engagement data-post-id="${escape(post.id)}" data-detail="${detail}" aria-label="阅览与评价"><div class="engagement-actions"><span class="view-count">◉ <span data-views>—</span> 次阅览</span><div class="reaction-buttons"><button type="button" data-vote="1" aria-pressed="false" disabled>↑ 赞 <span data-likes>—</span></button><button type="button" data-vote="-1" aria-pressed="false" disabled>↓ 踩 <span data-dislikes>—</span></button></div><a class="comment-shortcut" href="${escape(post.canonicalPath)}#comments">评论 <span data-comment-count>—</span></a></div><p class="engagement-status" aria-live="polite"><span data-status>正在加载统计…</span> <button type="button" data-stats-retry hidden>重试</button></p></section>
 <div class="share-actions" data-share data-share-path="${escape(post.canonicalPath)}" data-share-title="${escape(post.title || '一条生活记录')}" data-share-body="${escape(post.excerpt || post.body.slice(0, 600))}" data-share-image="${escape(post.media.find((m) => m.kind === 'image')?.storageKey)}" data-share-date="${escape(post.firstPublishedAt)}" data-share-location="${escape(post.location?.label)}"><button type="button" data-copy-link>复制链接 ↗</button><button type="button" data-share-image-button>生成分享图片 ▧</button><span data-share-status aria-live="polite"></span><dialog class="share-dialog" aria-label="分享图片预览"><div class="lightbox-toolbar"><strong>分享这条记录</strong><button type="button" data-share-close>关闭 ✕</button></div><img data-share-preview alt="包含这条记录、稳定链接和二维码的分享图片"><p>图片是内容摘要，完整内容请打开链接。</p><div class="share-dialog-actions"><a data-share-download download="sfsafi-post.png">保存图片 ↓</a><button type="button" data-share-native hidden>系统分享 ↗</button></div></dialog></div></div></article>`;
}
function heading(title: string, description = '') {
  return `<section class="page-heading"><div class="eyebrow">NOTES IN THIS SPACE</div><h1>${escape(title)}</h1><p>${escape(description)}</p></section>`;
}
export function commentsMarkup(postId: string) {
  return `<section id="comments" class="comments-panel" data-comments data-post-id="${escape(postId)}"><h2>评论</h2><p>评论提交后直接显示，站主可删除。</p><div data-comments-list></div><button data-comments-more hidden>更多评论</button><form data-comment-form><label>昵称<input name="nickname" maxlength="30" required autocomplete="nickname"></label><label>评论<textarea name="body" maxlength="1000" rows="4" required></textarea></label><label>邮箱（选填）<input name="email" type="email" maxlength="254" autocomplete="email" disabled></label><small data-comment-email-hint>邮箱仅用于回复通知，不会公开展示。提交后需在邮件中确认，可随时退订。</small><p data-comment-reply hidden></p><button type="button" data-comment-cancel-reply hidden>取消回复</button><button type="submit">提交评论</button></form><p data-comments-status role="status"></p></section>`;
}
interface PageEnv extends OwnerEnv, SiteConfig {
  DB?: D1Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
}
export async function pageRoute(
  request: Request,
  env: PageEnv,
): Promise<Response | undefined> {
  if (!env.DB) return;
  const url = new URL(request.url),
    path = url.pathname,
    repo = contentRepository(env.DB);
  if (!['GET', 'HEAD'].includes(request.method))
    return new Response('Method not allowed', { status: 405 });
  let title = '动态',
    main = '',
    description = '记录生活与工程笔记。',
    status = 200;
  let currentPost: Post | undefined;
  const detail = path.match(/^\/posts\/([a-z0-9-]+)\/$/);
  const paged = path.match(/^\/(page|articles\/page)\/([1-9][0-9]*)\/$/);
  const tag = path.match(/^\/tags\/([^/]+)\/$/);
  const location = path.match(/^\/locations\/([^/]+)\/$/);
  if (detail) {
    const post = await repo.getPublished(detail[1]);
    if (!post)
      return new Response(
        await (
          await env.ASSETS.fetch(new Request(url.origin + '/404.html'))
        ).text(),
        {
          status: 404,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        },
      );
    title = post.title || '一条生活记录';
    currentPost = post;
    description = post.excerpt || contentText(post).slice(0, 160);
    const related = await repo.getRelatedPublished(post, 3);
    main = `<a class="back-link" href="/">← 回到动态</a>${card(post, true)}${related.length ? `<section class="related-posts"><h2>接着读一段。</h2><div class="related-grid" data-user-content>${related.map((p) => `<a href="${escape(p.canonicalPath)}"><strong>${escape(p.title || contentText(p).slice(0, 45))}</strong><span>${formatDate(p.firstPublishedAt!)} · ${p.kind === 'article' ? '文章' : '动态'}</span></a>`).join('')}</div></section>` : ''}${commentsMarkup(post.id)}`;
  } else if (path === '/tags/') {
    title = '标签';
    main =
      heading('顺着兴趣走。') +
      '<div class="tag-directory">' +
      (await repo.getTags())
        .map(
          (t) =>
            `<a href="/tags/${encodeURIComponent(t)}/"><span>#</span><h2 data-user-content>${escape(t)}</h2><span>↗</span></a>`,
        )
        .join('') +
      '</div>';
  } else if (path === '/locations/') {
    title = '地点';
    main =
      heading('记录里的地点。', '地点由站主手动填写，不获取访客定位。') +
      '<div class="tag-directory" data-location-directory></div>';
  } else if (
    path === '/' ||
    paged ||
    path === '/articles/' ||
    tag ||
    location
  ) {
    const page = paged
      ? Number(paged[2])
      : tag || location
        ? Number(url.searchParams.get('page') || 1)
        : 1;
    if (!Number.isSafeInteger(page) || page > 100000)
      return new Response('Not found', { status: 404 });
    let tagName: string | undefined, locationId: string | undefined;
    try {
      tagName = tag ? decodeURIComponent(tag[1]) : undefined;
      locationId = location ? decodeURIComponent(location[1]) : undefined;
    } catch {
      return new Response('Not found', { status: 404 });
    }
    if (tagName && !(await repo.getTags()).includes(tagName)) status = 404;
    if (
      locationId &&
      !(await repo.getLocations()).some((l) => l.id === locationId)
    )
      status = 404;
    const articles = path.startsWith('/articles/');
    const view =
      !tag &&
      !location &&
      !articles &&
      ['notes', 'media'].includes(url.searchParams.get('view') || '')
        ? url.searchParams.get('view')!
        : 'all';
    const result = await repo.listPublished({
      page,
      pageSize: 4,
      kind: articles ? 'article' : view === 'notes' ? 'note' : undefined,
      media: view === 'media',
      tag: tagName,
      location: locationId,
    });
    if (!result.items.length && page > 1) status = 404;
    title = tagName
      ? `# ${tagName}`
      : articles
        ? '文章'
        : locationId
          ? '地点记录'
          : view === 'media'
            ? '图片与视频'
            : view === 'notes'
              ? '日常动态'
              : page > 1
                ? `动态 · 第 ${page} 页`
                : '动态';
    main =
      heading(title, page > 1 ? `第 ${page} 页` : '慢慢写，慢慢生活。') +
      (!tag && !location
        ? `<nav class="feed-tabs" aria-label="内容分类">${[
            ['/', '全部', !articles && view === 'all'],
            ['/?view=notes', '短动态', view === 'notes'],
            ['/?view=media', '图片与视频', view === 'media'],
            ['/articles/', '长文', articles],
          ]
            .map(
              ([href, label, active]) =>
                `<a href="${href}" ${active ? 'class="selected" aria-current="page"' : ''}>${label}</a>`,
            )
            .join(
              '',
            )}</nav><nav class="feed-discovery" aria-label="按标签发现">${(
            await repo.getTags()
          )
            .slice(0, 8)
            .map(
              (t) =>
                `<a data-user-content href="/tags/${encodeURIComponent(t)}/"># ${escape(t)}</a>`,
            )
            .join('')}<a href="/tags/">全部标签 ↗</a></nav>`
        : '') +
      '<div class="feed">' +
      result.items.map((p) => card(p)).join('') +
      '</div>';
    if (!result.items.length)
      main += '<div class="empty-state">这里还没有公开内容。</div>';
    if (!tag && !location) {
      main +=
        '<div class="pagination">' +
        (page > 1
          ? `<a href="${page === 2 ? (articles ? '/articles/' : '/') : `/${articles ? 'articles/' : ''}page/${page - 1}/`}${view !== 'all' ? '?view=' + view : ''}">← 更新的记录</a>`
          : '') +
        (result.hasMore
          ? `<a class="load-more" href="/${articles ? 'articles/' : ''}page/${page + 1}/${view !== 'all' ? '?view=' + view : ''}">更早的记录 →</a>`
          : '') +
        '</div>';
    } else if (result.hasMore) {
      const next = new URL(url);
      next.searchParams.set('page', String(page + 1));
      main += `<a class="load-more" href="${escape(next.pathname + next.search)}">更早的记录 →</a>`;
    }
  } else return;
  const template = await env.ASSETS.fetch(
    new Request(url.origin + '/runtime/'),
  );
  if (!template.ok)
    return new Response('Page template unavailable', { status: 503 });
  const canonicalUrl = new URL(path, siteOrigin(env));
  if (!detail)
    for (const key of ['view', 'page']) {
      const value = url.searchParams.get(key);
      if (
        (key === 'view' && ['notes', 'media'].includes(value || '')) ||
        (key === 'page' &&
          (tag || location) &&
          /^[1-9]\d*$/.test(value || '') &&
          value !== '1')
      )
        canonicalUrl.searchParams.set(key, value!);
    }
  let html = (await template.text())
    .replace(
      /<title>[\s\S]*?<\/title>/,
      () => `<title>${escape(title)} · SFSafi 的个人空间</title>`,
    )
    .replace(
      /<meta name="description"[^>]*>/,
      () => `<meta name="description" content="${escape(description)}">`,
    )
    .replace(/<main\b[^>]*>[\s\S]*?<\/main>/, (original) => {
      const scripts = original.match(/<script\b[\s\S]*?<\/script>/g) || [];
      return `<main id="main" tabindex="-1">${main}${scripts.join('')}</main>`;
    });
  const meta: Record<string, string> = {
    'og:title': `${title} · SFSafi 的个人空间`,
    'twitter:title': `${title} · SFSafi 的个人空间`,
    'og:description': description,
    'twitter:description': description,
    'og:url': canonicalUrl.href,
    'og:type': currentPost ? 'article' : 'website',
  };
  html = html
    .replace(
      /<link rel="canonical"[^>]*>/,
      () => `<link rel="canonical" href="${escape(canonicalUrl.href)}">`,
    )
    .replace(
      /<meta (property|name)="([^"]+)"[^>]*>/g,
      (original, attribute, name) =>
        name in meta
          ? `<meta ${attribute}="${name}" content="${escape(meta[name])}">`
          : original,
    );
  if (currentPost) {
    const profile = await publicProfile(env);
    const structured = JSON.stringify({
      '@context': 'https://schema.org',
      '@type':
        currentPost.kind === 'article' ? 'BlogPosting' : 'SocialMediaPosting',
      headline: title,
      description,
      mainEntityOfPage: canonicalUrl.href,
      datePublished: currentPost.firstPublishedAt,
      dateModified: currentPost.updatedAt,
      author: { '@type': 'Person', name: profile.name },
      inLanguage: 'zh-CN',
    }).replace(/</g, '\\u003c');
    html = html.replace(
      '</head>',
      () => `<script type="application/ld+json">${structured}</script></head>`,
    );
  }
  if (status >= 400)
    html = html.replace(
      '</head>',
      '<meta name="robots" content="noindex,nofollow"></head>',
    );
  return new Response(request.method === 'HEAD' ? null : html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
