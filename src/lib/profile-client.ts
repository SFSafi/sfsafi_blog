export interface PublicProfile {
  name: string;
  bio: string;
  location: string;
  handle: string;
  avatarUrl: string;
}
export async function refreshProfile() {
  try {
    const response = await fetch('/api/profile', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return;
    const profile: PublicProfile = await response.json();
    document.title = `${document.title.split(' · ')[0]} · ${profile.name} 的个人空间`;
    document
      .querySelector('[data-profile-brand]')
      ?.setAttribute('aria-label', `${profile.name} 个人空间首页`);
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
