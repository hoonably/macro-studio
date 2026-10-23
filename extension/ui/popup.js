const $ = id => document.getElementById(id);
let state = null, busy = false;
async function request(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || '확장 프로그램 응답이 없습니다.');
  return response.value;
}
function render(message = '', error = false) {
  $('site-toggle').disabled = busy || !state;
  $('site-toggle').setAttribute('aria-checked', String(!!state?.enabled));
  $('toggle-state').textContent = state?.enabled ? 'ON' : 'OFF';
  $('status').dataset.error = String(error);
  $('status').textContent = message || (state?.enabled ?
    '페이지의 파란 버튼 → 새 자동화 만들기에서\n작업을 기록하세요.' : 'ON으로 켜면 페이지에 파란 버튼이 나타납니다.');
}
$('site-toggle').addEventListener('click', async () => {
  if (!state || busy) return;
  const enabled = !state.enabled, target = state;
  busy = true; render('적용 중…');
  try {
    // Request only this origin, directly within the click's user gesture.
    if (enabled && !target.allowed && !await chrome.permissions.request({ origins: [target.pattern] })) {
      render('사이트 접근을 허용해야 파란 버튼을 표시할 수 있습니다.');
      return;
    }
    state = await request('site:set', { tabId: target.tabId, origin: target.origin, enabled });
    render();
  } catch (error) { render(error.message, true); }
  finally { busy = false; $('site-toggle').disabled = !state; }
});
$('scripts').addEventListener('click', async () => {
  try { await request('local:open'); window.close(); }
  catch (error) { render(error.message, true); }
});
try {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state = await request('site:state', { tabId: tab?.id });
  $('site').textContent = new URL(state.origin).host;
  $('site').title = state.origin;
  render();
} catch (error) {
  $('site').textContent = '사용할 수 없는 페이지';
  render(error.message, true);
}
