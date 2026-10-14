import { contentRepository } from './content-repository';
import { getSiteCopy } from './site-copy';
import { publicProfile } from './profile';
import type { OwnerEnv } from './owner';
import { siteOrigin, type SiteConfig } from '../src/lib/site';
import { escapeHtml, contentText } from '../src/lib/text';
const xml = (value: unknown) =>
  escapeHtml(
    String(value ?? '').replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF\uD800-\uDFFF]/gu,
      '',
    ),
  );
export async function discoveryRoute(
  request: Request,
  env: OwnerEnv & SiteConfig,
) {
  const path = new URL(request.url).pathname;
  if (!['/rss.xml', '/sitemap.xml', '/robots.txt'].includes(path)) return;
  if (!['GET', 'HEAD'].includes(request.method))
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    });
  const origin = siteOrigin(env),
    repo = contentRepository(env.DB);
  let body: string,
    type = 'application/xml; charset=utf-8';
  if (path === '/robots.txt') {
    body = `User-agent: *\nDisallow: /admin/\nDisallow: /api/\nDisallow: /runtime/\nSitemap: ${origin}/sitemap.xml\n`;
    type = 'text/plain; charset=utf-8';
  } else if (path === '/rss.xml') {
    const [{ settings, revision }, profile, { items }] = await Promise.all([
      getSiteCopy(env),
      env.DB ? publicProfile(env) : repo.getProfile(),
      repo.listPublished({ page: 1, pageSize: 50, order: 'newest' }),
    ]);
    const title = revision ? settings.siteTitle : `${profile.name} 的个人空间`;
    body = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${xml(title)}</title><link>${origin}/</link><description>${xml(profile.bio)}</description><language>zh-cn</language><atom:link href="${origin}/rss.xml" rel="self" type="application/rss+xml"/>${items.map((p) => `<item><title>${xml(p.title || contentText({ ...p, body: p.body.slice(0, 1200) }).slice(0, 60))}</title><link>${origin}${xml(p.canonicalPath)}</link><guid isPermaLink="true">${origin}${xml(p.canonicalPath)}</guid><pubDate>${new Date(p.firstPublishedAt!).toUTCString()}</pubDate><description>${xml((p.sample ? '示例内容 · ' : '') + (p.excerpt || contentText({ ...p, body: p.body.slice(0, 1200) }).slice(0, 600)))}</description>${p.tags.map((tag) => `<category>${xml(tag)}</category>`).join('')}</item>`).join('')}</channel></rss>`;
    type = 'application/rss+xml; charset=utf-8';
  } else {
    const links = [
      '/',
      '/articles/',
      '/tags/',
      '/locations/',
      '/about/',
      '/subscribe/',
    ].map((path) => `<url><loc>${origin}${path}</loc></url>`);
    const tags = await repo.getTags();
    links.push(
      ...tags.map(
        (tag) =>
          `<url><loc>${origin}/tags/${encodeURIComponent(tag)}/</loc></url>`,
      ),
    );
    let page = 1;
    while (true) {
      const result = await repo.listPublishedLinks(page, 1000);
      for (const p of result.items)
        links.push(
          `<url><loc>${origin}${xml(p.path)}</loc><lastmod>${xml(p.updatedAt)}</lastmod></url>`,
        );
      if (!result.hasMore) break;
      if (page >= 10)
        return new Response('Sitemap requires multiple files', {
          status: 503,
          headers: { 'Cache-Control': 'no-store' },
        });
      page++;
    }
    if (links.length > 50000)
      return new Response('Sitemap exceeds the single-file limit', {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    body = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${links.join('')}</urlset>`;
  }
  return new Response(request.method === 'HEAD' ? null : body, {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
