import { setupReady, scriptsPath } from '../core/script-setup.js';
let request = 0;
async function refresh() {
  const current = ++request;
  try {
    const result = await chrome.runtime.sendMessage({type:'local:status'});
    if (current !== request) return;
    if (!result?.ok || !setupReady(result.value)) {
      document.querySelector('.library-main').hidden = true;
      if (window.parent !== window) window.parent.postMessage({type:'macro-studio:setup-required'}, chrome.runtime.getURL('').replace(/\/$/,''));
      return;
    }
    const path = scriptsPath(result.value.folderPath, result.value.folderRelativePath);
    document.getElementById('workspace-path').textContent = path;
    document.getElementById('workspace-path').title = path;
    document.querySelector('.library-main').hidden = false;
  } catch {
    document.querySelector('.library-main').hidden = true;
    window.MacroStudioPanel.open('scripts').catch(() => {});
  }
}
document.getElementById('workspace-settings').addEventListener('click', () => window.MacroStudioPanel.open('scripts'));
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.macroStudioLocalScripts) refresh(); });
window.addEventListener('focus', refresh);
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') refresh(); });
await refresh();
