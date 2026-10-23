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

// A bundled or newly synced script never opts a site in on the user's behalf.
export function siteEnabled(settings, origin) {
  return settings[origin] === true;
}
