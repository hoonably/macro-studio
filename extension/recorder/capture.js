"use strict";
(() => {
  if (window.__macroStudioCaptureInstalled) return;
  window.__macroStudioCaptureInstalled = true;
  let recordingId = null;
  const pending = new Map();
  const send = event => {
    if (!recordingId) return Promise.resolve();
    return chrome.runtime.sendMessage({ type: 'capture:event', recordingId, event }).catch(() => {});
  };
  const sensitive = element => ['password', 'hidden', 'file'].includes(element.type) ||
    /password|passwd|passcode|secret|token|authorization|api[-_ ]?key|otp|one[-_ ]?time|cc-|비밀번호|인증번호|카드번호/i.test(
      [element.name, element.id, element.autocomplete, element.getAttribute('aria-label')].join(' '));
  const quote = value => '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ') + '"';
  function describe(element) {
    const label = element.getAttribute('aria-label') ||
      [...(element.labels || [])].map(item => item.textContent).join(' ') ||
      (element.tagName === 'SELECT' ? element.name : element.textContent) || element.getAttribute('title') || element.name || '';
    const selectors = [];
    for (const attr of ['data-testid', 'data-test', 'name', 'aria-label']) {
      const value = element.getAttribute(attr);
      if (value && value.length < 160) selectors.push(element.localName + '[' + attr + '=' + quote(value) + ']');
    }
    if (element.id && !/^(?:WD|__|[a-f\d]{12,})/i.test(element.id)) selectors.unshift('#' + CSS.escape(element.id));
    const sapField = element.getAttributeNames().map(attr => attr.match(/((?:v_main|main)\.[\w.]+)"?$/)?.[1]).find(Boolean) || '';
    return { tag: element.localName, type: element.type || '', role: element.getAttribute('role') || '',
      name: element.name || '', id: element.id || '', autocomplete: element.autocomplete || '',
      label: label.replace(/\s+/g, ' ').trim().slice(0, 160), selectors, sapField };
  }
  const ownUI = event => event.composedPath().some(node => node?.id === 'macro-studio-launcher');
  function valueOf(element) {
    if (['checkbox', 'radio'].includes(element.type)) return !!element.checked;
    if (['checkbox', 'radio'].includes(element.getAttribute('role'))) return element.getAttribute('aria-checked') === 'true';
    return 'value' in element ? String(element.value).slice(0, 2000) : '';
  }
  function capture(action, element) {
    if (!recordingId || !element || sensitive(element)) return;
    return send({ action, target: describe(element), value: valueOf(element), page: { url: location.href, title: document.title } });
  }
  function flush() {
    const sent = [];
    for (const [element, timer] of pending) { clearTimeout(timer); sent.push(capture('input', element)); }
    pending.clear();
    return Promise.all(sent);
  }
  document.addEventListener('input', event => {
    if (!recordingId || !event.isTrusted || ownUI(event) || sensitive(event.target)) return;
    const element = event.target;
    clearTimeout(pending.get(element));
    pending.set(element, setTimeout(() => { pending.delete(element); capture('input', element); }, 250));
  }, true);
  document.addEventListener('change', event => {
    if (!recordingId || !event.isTrusted || ownUI(event)) return;
    clearTimeout(pending.get(event.target)); pending.delete(event.target);
    capture('change', event.target);
  }, true);
  document.addEventListener('click', event => {
    if (!recordingId || !event.isTrusted || ownUI(event)) return;
    flush();
    const element = event.target.closest?.('button,a,[role="button"],input[type="button"],input[type="submit"],[ct="B"]');
    if (element) capture('click', element);
  }, true);
  document.addEventListener('submit', event => {
    if (recordingId && event.isTrusted) { flush(); capture('submit', event.submitter || event.target); }
  }, true);
  window.addEventListener('pagehide', flush);
  window.addEventListener('popstate', () => {
    if (recordingId) send({ action: 'navigation', page: { url: location.href, title: document.title } });
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === 'capture:flush') { flush().then(() => respond({ ok: true })); return true; }
    if (message.type === 'capture:state') {
      recordingId = message.recordingId || null;
      if (!recordingId) { for (const timer of pending.values()) clearTimeout(timer); pending.clear(); }
      respond({ ok: true });
    }
  });
  chrome.runtime.sendMessage({ type: 'capture:status' }).then(response => {
    recordingId = response?.value?.recordingId || null;
    if (recordingId) send({ action: 'navigation', page: { url: location.href, title: document.title } });
  }).catch(() => {});
})();
