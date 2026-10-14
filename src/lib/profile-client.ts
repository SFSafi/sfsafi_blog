export interface PublicProfile {
  name: string;
  bio: string;
  location: string;
  handle: string;
  avatarUrl: string;
}
let previousSiteName = 'SFSafi 的个人空间';
export async function refreshProfile() {
  try {
    const response = await fetch('/api/profile', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return;
    const profile: PublicProfile = await response.json();
    let siteName = `${profile.name} 的个人空间`;
    try {
      const copy = JSON.parse(
        document.querySelector('#site-copy-config')?.textContent || '{}',
      );
      if (copy.configured && copy.siteTitle) siteName = copy.siteTitle;
    } catch {}
    let pageTitle = document.title;
    for (const candidate of [previousSiteName, siteName, 'SFSafi 的个人空间']) {
      const suffix = ' · ' + candidate;
      if (pageTitle.endsWith(suffix)) {
        pageTitle = pageTitle.slice(0, -suffix.length);
        break;
      }
    }
    document.title = `${pageTitle} · ${siteName}`;
    previousSiteName = siteName;
    document
      .querySelector('[data-profile-brand]')
      ?.setAttribute('aria-label', `${siteName}首页`);
    for (const element of document.querySelectorAll('[data-profile-name]'))
      element.textContent = profile.name;
    for (const element of document.querySelectorAll<HTMLImageElement>(
      '[data-profile-avatar]',
    )) {
      element.src = profile.avatarUrl;
      element.alt = `${profile.name} 的头像`;
    }
    for (const element of document.querySelectorAll('[data-profile-bio]'))
      element.textContent = profile.bio;
    for (const element of document.querySelectorAll('[data-profile-location]'))
      element.textContent = profile.location;
  } catch {}
}
export const profileReady = refreshProfile();
