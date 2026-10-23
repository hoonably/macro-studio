export const SITES_KEY = 'macroStudioSites';

export function siteOrigin(value) {
  try {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.origin;
  } catch {}
  return null;
}

export function siteSettings(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([origin, enabled]) =>
    siteOrigin(origin) === origin && typeof enabled === 'boolean'));
}

// Preserve existing script sites until the user explicitly chooses ON or OFF.
export function siteEnabled(settings, origin, scripts, library) {
  if (typeof settings[origin] === 'boolean') return settings[origin];
  return scripts.some(script => !script.unavailable && !library.deleted.includes(script.id));
}
