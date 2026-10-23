// Permissions.getAll also includes required content-script hosts. Never revoke those.
const host = pattern => /^([*]|https?):\/\/([^/]+)\//.exec(pattern || '');
function covers(required, granted) {
  if (required === '<all_urls>') return true;
  const a = host(required), b = host(granted);
  if (!a || !b) return required === granted;
  return (a[1] === '*' || a[1] === b[1]) && (a[2] === '*' || a[2] === b[2] ||
    a[2].startsWith('*.') && (b[2] === a[2].slice(2) || b[2].endsWith(a[2].slice(1))));
}
export function optionalResetPermissions(manifest, granted) {
  const required = [...(manifest.host_permissions || []), ...(manifest.permissions || []).filter(value => host(value)),
    ...(manifest.content_scripts || []).flatMap(entry => entry.matches || [])];
  return {
    origins: (granted.origins || []).filter(origin => host(origin) && !required.some(pattern => covers(pattern, origin))),
    permissions: (granted.permissions || []).filter(permission => permission === 'webNavigation' &&
      (manifest.optional_permissions || []).includes(permission) && !(manifest.permissions || []).includes(permission))
  };
}
