import { setupReady } from '../core/script-setup.js';
const routes = { studio: 'studio.html', library: 'library.html', scripts: 'scripts.html', privacy: 'privacy.html', reset: 'reset.html', updates: 'studio.html' };
const origin = chrome.runtime.getURL('').replace(/\/$/,'');
const frames = new Map();
const currentWindow = await chrome.windows.getCurrent();
const windowId = currentWindow.id;
let currentPage = 'studio', requestedPage = 'studio', permissionId = null, navigation = 0, managing = false;
function show(page) {
  if (!routes[page]) return;
  currentPage = page;
  const key = page === 'updates' ? 'studio' : page;
  let frame = frames.get(key);
  if (!frame) {
    frame = document.createElement('iframe'); frame.src = routes[page]; frame.title = 'Macro Studio · ' + key;
    frame.addEventListener('load', () => {
      if (currentPage === 'updates' && key === 'studio') frame.contentWindow.postMessage({ type:'macro-studio:open-updates' }, origin);
      if (currentPage === 'scripts' && key === 'scripts' && managing) frame.contentWindow.postMessage({type:'macro-studio:edit-folder'}, origin);
    });
    frames.set(key, frame); document.getElementById('views').append(frame);
  }
  for (const [name, view] of frames) view.hidden = name !== key;
  document.getElementById('loading')?.remove();
  if (page === 'updates') frame.contentWindow?.postMessage({ type:'macro-studio:open-updates' }, origin);
  if (page === 'scripts' && managing) frame.contentWindow?.postMessage({type:'macro-studio:edit-folder'}, origin);
}
async function navigate(page) {
  if (!routes[page]) return;
  const check = ++navigation;
  if (page === 'scripts') { managing = true; show('scripts'); return; }
  managing = false;
  if (!['studio', 'library'].includes(page)) { show(page); return; }
  requestedPage = page;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'local:status' });
    if (check !== navigation) return;
    if (!response?.ok || !setupReady(response.value)) {
      // Existing recordings retain their stop control while access is recovered.
      const recording = page === 'studio' ? await chrome.runtime.sendMessage({type:'studio:state'}) : null;
      if (check !== navigation) return;
      show(recording?.value?.status === 'recording' ? 'studio' : 'scripts');
      return;
    }
    show(page);
  } catch { if (check === navigation) show('scripts'); }
}

function showPermissions(id) {
  if (!id || permissionId === id) return;
  permissionId = id;
  const frame = document.createElement('iframe'); frame.title = '내부 사이트 허용';
  frame.src = 'frame-permissions.html?recording=' + encodeURIComponent(id);
  const view = document.getElementById('permission-view'); view.replaceChildren(frame); view.hidden = false;
}
function hidePermissions() {
  permissionId = null;
  const view = document.getElementById('permission-view'); view.hidden = true; view.replaceChildren();
}
window.addEventListener('message', event => {
  if (event.origin !== origin || ![...frames.values()].some(frame => frame.contentWindow === event.source)) return;
  if (event.source === frames.get('scripts')?.contentWindow && ['macro-studio:setup-ready', 'macro-studio:setup-continue'].includes(event.data?.type)) {
    if (currentPage === 'scripts' && (!managing || event.data.type === 'macro-studio:setup-continue')) navigate(requestedPage);
    return;
  }
  if (event.data?.type === 'macro-studio:setup-required') { navigate(requestedPage); return; }
  if (event.data?.type === 'macro-studio:show-permissions') {
    chrome.runtime.sendMessage({type:'studio:state'}).then(reply=>{ if (reply?.value?.pendingFrameOrigins?.length) showPermissions(reply.value.id); });
    return;
  }
  if (event.data?.type !== 'macro-studio:panel-navigate' || !routes[event.data.page]) return;
  navigate(event.data.page);
  chrome.runtime.sendMessage({ type:'panel:remember',windowId,page:event.data.page }).catch(() => {});
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.windowId !== windowId) return;
  if (message.type === 'panel:permissions') {
    if (document.visibilityState === 'hidden') { respond({shown:false});return; }
    showPermissions(message.recordingId); respond({ shown:true });
  }
  if (message.type === 'panel:permissions-clear') hidePermissions();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.macroStudioPanelRoutes) navigate(changes.macroStudioPanelRoutes.newValue?.[windowId] || 'studio');
  if (area === 'local' && changes.macroStudioLocalScripts && !managing && ['studio','library'].includes(currentPage)) navigate(requestedPage);
  if (area === 'session' && changes.macroStudioRecording) {
    const state = changes.macroStudioRecording.newValue;
    if (permissionId && (state?.id !== permissionId || state.status !== 'recording' || !state.pendingFrameOrigins?.length)) hidePermissions();
  }
});
const { macroStudioPanelRoutes = {} } = await chrome.storage.local.get('macroStudioPanelRoutes');
await navigate(macroStudioPanelRoutes[windowId] || 'studio');
const reply = await chrome.runtime.sendMessage({ type:'studio:state' });
if (reply?.value?.status === 'recording' && reply.value.pendingFrameOrigins?.length) {
  const tab = await chrome.tabs.get(reply.value.tabId).catch(() => null);
  if (tab?.windowId === windowId) showPermissions(reply.value.id);
}

window.addEventListener('focus', () => { if (!managing && ['studio','library'].includes(currentPage)) navigate(requestedPage); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden' && !managing && ['studio','library'].includes(currentPage)) navigate(requestedPage); });
