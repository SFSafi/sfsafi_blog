export const PRIMARY_SITE_ORIGIN = 'https://sfsafi-blog.uk';
export interface SiteConfig {
  PUBLIC_SITE_URL?: string;
}
export function siteOrigin(env: SiteConfig = {}) {
  try {
    const url = new URL(env.PUBLIC_SITE_URL || PRIMARY_SITE_ORIGIN);
    if (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
    )
      return url.origin;
  } catch {}
  return PRIMARY_SITE_ORIGIN;
}
