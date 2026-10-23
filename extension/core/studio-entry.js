"use strict";
(() => {
  if (window.__macroStudioEntryInstalled) return;
  window.__macroStudioEntryInstalled = true;
  if (window !== window.top) return;
  const matches = pattern => {
    const expression = '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
    return new RegExp(expression).test(location.href);
  };
  // A MAIN-world site adapter owns its launcher; avoid a second isolated-world icon.
  const mainOwnsUI = chrome.runtime.getManifest().content_scripts?.some(entry =>
    entry.world === 'MAIN' && entry.matches.some(matches));
  if (!mainOwnsUI && !document.getElementById('macro-studio-launcher')) window.MacroStudio.launcher.create();
  document.addEventListener('click', event => {
    const path = event.composedPath();
    if (!event.isTrusted || !path.some(node => node?.id === 'macro-studio-launcher') ||
        !path.some(node => node?.dataset?.studioAction === 'open')) return;
    chrome.runtime.sendMessage({ type: 'studio:open' }).catch(error => console.warn('Macro Studio:', error.message));
  }, true);
})();
