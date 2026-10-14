import catalog from '../src/lib/copy-catalog.json';
import type { HTMLRewriterElementContentHandlers } from '@cloudflare/workers-types';
interface CopyRewriter {
  on(
    selector: string,
    handlers: HTMLRewriterElementContentHandlers,
  ): CopyRewriter;
  transform(response: Response): Response;
}
declare const HTMLRewriter: { new (): CopyRewriter };
import { createCopyTranslator } from '../src/lib/copy-text';
import { requireOwner, json, type OwnerEnv } from './owner';
import { readLimitedText, BodyTooLargeError } from './http';
export interface SiteCopy {
  siteTitle: string;
  includeAdmin: boolean;
  overrides: Record<string, string>;
}
const defaults: SiteCopy = {
  siteTitle: 'SFSafi 的个人空间',
  includeAdmin: false,
  overrides: {},
};
export async function getSiteCopy(env: OwnerEnv) {
  const row = await env.DB?.prepare(
    "SELECT document,revision FROM site_settings WHERE id='copy'",
  ).first<{ document: string; revision: number }>();
  return {
    settings: row ? (JSON.parse(row.document) as SiteCopy) : defaults,
    revision: row?.revision || 0,
  };
}
export async function siteCopyRoute(request: Request, env: OwnerEnv) {
  if (new URL(request.url).pathname !== '/api/admin/site-copy') return null;
  const denied = await requireOwner(request, env);
  if (denied) return denied;
  if (!env.DB) return json({ error: '站点设置存储尚未配置。' }, 503);
  if (request.method === 'GET')
    return json({ ...(await getSiteCopy(env)), catalog });
  if (request.method !== 'POST')
    return json({ error: '请求方法不支持。' }, 405);
  if (request.headers.get('Origin') !== new URL(request.url).origin)
    return json({ error: '请求来源无效。' }, 403);
  if (!request.headers.get('Content-Type')?.startsWith('application/json'))
    return json({ error: '需要 JSON 请求。' }, 415);
  let body;
  try {
    body = JSON.parse(await readLimitedText(request, 262144));
  } catch (error) {
    return json(
      { error: '文案内容无效或过大。' },
      error instanceof BodyTooLargeError ? 413 : 400,
    );
  }
  if (
    !Number.isSafeInteger(body?.revision) ||
    body.revision < 0 ||
    typeof body.siteTitle !== 'string' ||
    !body.siteTitle.trim() ||
    body.siteTitle.length > 120 ||
    typeof body.includeAdmin !== 'boolean' ||
    !body.overrides ||
    typeof body.overrides !== 'object' ||
    Array.isArray(body.overrides)
  )
    return json({ error: '站名、文案或版本格式无效。' }, 400);
  const allowed = new Map(catalog.map((entry) => [entry.id, entry.text]));
  const overrides: Record<string, string> = {};
  for (const [id, value] of Object.entries(body.overrides)) {
    const original = allowed.get(id);
    if (
      original === undefined ||
      typeof value !== 'string' ||
      value.length > 4000
    )
      return json({ error: '存在未知文案或超过 4000 字的内容。' }, 400);
    const placeholders = (text: string) =>
      [...text.matchAll(/\{\d+\}/g)]
        .map((m) => m[0])
        .sort()
        .join(',');
    if (placeholders(original) !== placeholders(value))
      return json({ error: '请保留动态文案中的 {0} 等占位符。' }, 400);
    if (value !== original) overrides[id] = value;
  }
  const settings: SiteCopy = {
    siteTitle: body.siteTitle.trim(),
    includeAdmin: body.includeAdmin,
    overrides,
  };
  const document = JSON.stringify(settings),
    revision = body.revision + 1;
  const row =
    body.revision === 0
      ? await env.DB.prepare(
          "INSERT INTO site_settings(id,document,revision,updated_at) VALUES('copy',?,?,?) ON CONFLICT DO NOTHING RETURNING revision",
        )
          .bind(document, revision, new Date().toISOString())
          .first()
      : await env.DB.prepare(
          "UPDATE site_settings SET document=?,revision=?,updated_at=? WHERE id='copy' AND revision=? RETURNING revision",
        )
          .bind(document, revision, new Date().toISOString(), body.revision)
          .first();
  return row
    ? json({ settings, revision })
    : json({ error: '另一页面已更新文案，请重新载入后再保存。' }, 409);
}
function decode(text: string) {
  return text.replace(
    /&(?:amp|lt|gt|quot|apos|#39|#x27|nbsp);/gi,
    (v) =>
      ({
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&apos;': "'",
        '&#39;': "'",
        '&#x27;': "'",
        '&nbsp;': ' ',
      })[v.toLowerCase()] || v,
  );
}
const voidTags = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);
export async function applySiteCopy(
  request: Request,
  env: OwnerEnv,
  response: Response,
) {
  if (
    !env.DB ||
    !response.headers.get('Content-Type')?.includes('text/html') ||
    request.method === 'HEAD'
  )
    return response;
  const { settings, revision } = await getSiteCopy(env);
  const allowed = new Map(catalog.map((entry) => [entry.id, entry]));
  const admin = new URL(request.url).pathname.startsWith('/admin/');
  const enabled =
    !admin || (settings.includeAdmin && !(await requireOwner(request, env)));
  const values: Record<string, string> = Object.create(null);
  for (const [id, value] of Object.entries(settings.overrides)) {
    const entry = allowed.get(id);
    if (
      entry &&
      enabled &&
      (admin || entry.groups.some((group) => group !== '管理界面'))
    )
      values[entry.text] = value;
  }
  const translate = createCopyTranslator(values);
  const content = /^\/(posts\/|tags\/.+\/|locations\/.+\/)/.test(
    new URL(request.url).pathname,
  );
  let skip = false,
    inTitle = false,
    buffer = '';
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  for (const key of ['Content-Length', 'ETag', 'Last-Modified'])
    headers.delete(key);
  const config = JSON.stringify({
    overrides: values,
    includeAdmin: settings.includeAdmin,
    siteTitle: settings.siteTitle,
    configured: revision > 0,
  }).replace(/</g, '\\u003c');
  return new HTMLRewriter()
    .on('head', {
      element(el) {
        el.append(
          `<script type="application/json" id="site-copy-config">${config}</script>`,
          { html: true },
        );
      },
    })
    .on('*', {
      element(el) {
        const previous = skip,
          previousTitle = inTitle,
          tag = el.tagName;
        if (el.hasAttribute('data-site-title') && revision > 0)
          el.setInnerContent(settings.siteTitle);
        const classes = (el.getAttribute('class') || '').split(/\s+/);
        const protectedNode =
          ['script', 'style', 'textarea', 'code', 'pre', 'time'].includes(
            tag,
          ) ||
          [
            'data-user-content',
            'data-site-title',
            'data-copy-skip',
            'data-profile-name',
            'data-profile-bio',
            'data-profile-location',
          ].some((a) => el.hasAttribute(a)) ||
          classes.some((c) =>
            [
              'post-title',
              'post-body',
              'tags',
              'post-location',
              'copy-original',
            ].includes(c),
          ) ||
          el.getAttribute('id') === 'image-caption' ||
          (content && ['title'].includes(tag));
        if (!voidTags.has(tag)) {
          skip = previous || protectedNode;
          inTitle = previousTitle || tag === 'title';
          el.onEndTag(() => {
            skip = previous;
            inTitle = previousTitle;
          });
        }
        if (enabled && !skip)
          for (const name of ['placeholder', 'aria-label', 'title']) {
            const value = el.getAttribute(name);
            if (value !== null) el.setAttribute(name, translate(value));
          }
        if (
          enabled &&
          !content &&
          tag === 'meta' &&
          el.getAttribute('name') === 'description'
        ) {
          const value = el.getAttribute('content');
          if (value !== null) el.setAttribute('content', translate(value));
        }
      },
      text(text) {
        // Always rename the site suffix, but never translate an article's own title.
        if ((!enabled || skip) && !inTitle) {
          return;
        }
        buffer += text.text;
        if (!text.lastInTextNode) {
          text.remove();
          return;
        }
        let translated =
          enabled && !skip ? translate(decode(buffer)) : decode(buffer);
        if (inTitle) {
          const original = decode(buffer);
          const suffix = ' · SFSafi 的个人空间';
          if (original.endsWith(suffix)) {
            const prefix = original.slice(0, -suffix.length);
            translated =
              (enabled && !content ? translate(prefix) : prefix) +
              ' · ' +
              settings.siteTitle;
          }
        }
        if (translated === decode(buffer)) text.replace(buffer, { html: true });
        else text.replace(translated);
        buffer = '';
      },
    })
    .transform(
      new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      }),
    );
}
