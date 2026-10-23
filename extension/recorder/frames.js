export function sitePattern(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('현재 탭의 주소를 확인할 수 없습니다. 웹사이트에서 도구모음의 Macro Studio 아이콘을 다시 눌러주세요.');
  }
  let url;
  try { url = new URL(value); }
  catch { throw new Error('현재 페이지의 주소를 읽지 못했습니다. 페이지가 열린 뒤 다시 확인해 주세요.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('일반 웹사이트에서 사용하세요.');
  }
  return url.origin + '/*';
}

export async function inspectFrames(chrome, tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error('확인할 웹페이지가 없습니다.');
  const tab = await chrome.tabs.get(tabId);
  const detectionEnabled = await chrome.permissions.contains({ permissions: ['webNavigation'] });
  const frames = detectionEnabled ? await chrome.webNavigation.getAllFrames({ tabId }) : [];
  // A side panel can remain open on a new tab without activeTab access. In that case
  // tabs.get omits url, even though an already-approved frame lookup can read it.
  // Use only the committed top frame; a child frame or pending navigation is not the target site.
  const topFrame = frames?.find(frame => frame.frameId === 0 && !frame.errorOccurred);
  const topPattern = sitePattern(topFrame?.url || tab.url);
  const topAllowed = await chrome.permissions.contains({ origins: [topPattern] });
  const groups = new Map();
  for (const frame of frames || []) {
    if (frame.frameId === 0 || frame.errorOccurred) continue;
    let pattern;
    try { pattern = sitePattern(frame.url); } catch { continue; }
    const group = groups.get(pattern) || { origin: pattern.slice(0, -2), pattern, frameIds: [] };
    if (!group.frameIds.includes(frame.frameId)) group.frameIds.push(frame.frameId);
    groups.set(pattern, group);
  }
  const sites = await Promise.all([...groups.values()].map(async group => ({ ...group,
    allowed: group.pattern === topPattern ? topAllowed : await chrome.permissions.contains({ origins: [group.pattern] })
  })));
  // Return origins only; frame URLs can contain session ids and other private paths.
  return { tabId, origin: topPattern.slice(0, -2), pattern: topPattern, topAllowed, detectionEnabled,
    frames: sites.filter(group => group.pattern !== topPattern).sort((a, b) => a.origin.localeCompare(b.origin)),
    permitted: [{ pattern: topPattern, frameIds: [0], allowed: topAllowed }, ...sites]
      .filter(group => group.allowed) };
}
