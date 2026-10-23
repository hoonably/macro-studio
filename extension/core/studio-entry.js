"use strict";
(() => {
  if (window.__macroStudioEntryInstalled) return;
  window.__macroStudioEntryInstalled = true;
  const HOST_ID = 'macro-studio-launcher', KEY = 'macroStudioScriptLibrary';
  const matches = pattern => {
    const expression = '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
    return new RegExp(expression).test(location.href);
  };
  // A MAIN-world site adapter owns its launcher; avoid a second isolated-world icon.
  const mainOwnsUI = chrome.runtime.getManifest().content_scripts?.some(entry =>
    entry.world === 'MAIN' && entry.matches.some(matches));
  if (window === window.top && !mainOwnsUI && !document.getElementById(HOST_ID)) window.MacroStudio.launcher.create();
  let host = null, state = { ready: false, archived: [], deleted: [] }, revision = 0, pending = null, activation = null;
  const wired = new WeakSet();
  function wire(current) {
    if (!current || wired.has(current)) return;
    wired.add(current);
    // Submission events do not cross a shadow root; listen inside the actual launcher.
    current.shadowRoot?.addEventListener('submit', event => {
      const form = event.target;
      if (!event.isTrusted || !state.ready || state.siteEnabled === false || !form?.dataset?.localScript) return;
      const token = activation = { id: form.dataset.localScript, revision: form.dataset.localRevision,
        values: Object.fromEntries([...form.querySelectorAll('input')].map(input => [input.name, input.value])) };
      // Chrome can flush microtasks between the isolated capture and MAIN submit listeners.
      // Keep this one-use, exact-form activation until the current event task ends.
      setTimeout(() => { if (activation === token) activation = null; }, 0);
    }, true);
    current.addEventListener('macro-studio:script-run', async event => {
      let data;
      try { data = JSON.parse(event.detail); } catch { return; }
      const trusted = activation; activation = null;
      if (!trusted || trusted.id !== data.id || trusted.revision !== data.revision ||
        JSON.stringify(trusted.values) !== JSON.stringify(data.values)) {
        current.dispatchEvent(new CustomEvent('macro-studio:script-result', { detail: JSON.stringify({ requestId: data.requestId, error: '실행 버튼을 직접 눌러주세요.' }) }));
        return;
      }
      try {
        const value = await request('local:run', data);
        current.dispatchEvent(new CustomEvent('macro-studio:script-result', { detail: JSON.stringify({ requestId: data.requestId, value }) }));
      } catch (error) { current.dispatchEvent(new CustomEvent('macro-studio:script-result', { detail: JSON.stringify({ requestId: data.requestId, error: error.message }) })); }
    });
  }
  const publish = (extra = {}) => {
    host = document.getElementById(HOST_ID);
    wire(host);
    if (host) host.dispatchEvent(new CustomEvent('macro-studio:library-state', {
      detail: JSON.stringify({ ...state, pending, ...extra })
    }));
  };
  const request = async (type, payload = {}) => {
    const response = await chrome.runtime.sendMessage({ type, ...payload });
    if (!response?.ok) throw new Error(response?.error || '확장 프로그램 응답이 없습니다.');
    return response.value;
  };
  async function refresh() {
    const current = ++revision;
    state = { ...state, ready: false }; publish();
    try {
      const connection = await request('local:connect');
      const value = await request('scripts:state');
      if (revision !== current) return;
      state = value; publish({ error: connection?.error || '' });
    } catch (error) {
      if (revision === current) publish({ error: error.message });
    }
  }
  document.addEventListener('click', async event => {
    const path = event.composedPath(), currentHost = document.getElementById(HOST_ID);
    if (!event.isTrusted || !currentHost || !path.includes(currentHost)) return;
    const action = path.find(node => node?.dataset?.studioAction && currentHost.shadowRoot?.contains(node));
    if (!action || action.disabled || !state.ready || state.siteEnabled === false) return;
    try {
      if (action.dataset.studioAction === 'open') {
        if (location.protocol !== 'chrome-extension:') await request('studio:open');
      } else if (action.dataset.studioAction === 'library') await request('library:open');
      else if (action.dataset.studioAction === 'archive-script' && !pending && state.ready) {
        event.preventDefault();
        const id = action.dataset.scriptId;
        if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(id)) return;
        const name = action.closest('.script-row')?.querySelector('strong')?.textContent || '이 스크립트';
        if (!window.confirm('“' + name + '”을 보관함으로 옮길까요?\n실행 목록에서 빠지며, 보관함에서 다시 복원할 수 있습니다.')) return;
        pending = id; publish();
        try {
          const value = await request('scripts:archive', { id });
          ++revision; state = value;
          publish({ pending: null, message: '보관함으로 옮겼습니다. 스크립트 보관함에서 복원하거나 삭제할 수 있습니다.' });
        } finally { pending = null; }
      }
    } catch (error) { publish({ pending: null, error: error.message }); }
  }, true);
  const observer = new MutationObserver(() => {
    if (document.getElementById(HOST_ID) !== host) publish();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes[KEY] || changes.macroStudioSites || changes.macroStudioLocalScripts?.newValue?.revision !== changes.macroStudioLocalScripts?.oldValue?.revision)) refresh();
  });
  chrome.runtime.onMessage.addListener(message => { if (message.type === 'local:changed') refresh(); });
  refresh();
})();
