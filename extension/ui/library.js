const $ = selector => document.querySelector(selector);
let state = { catalog: [], archived: [], deleted: [] }, busy = false, pendingDelete = null, revision = 0;
const status = (text, error = false) => { $('#library-status').textContent = text; $('#library-status').dataset.error = String(error); };
async function request(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || '확장 프로그램 응답이 없습니다.');
  return response.value;
}
function render() {
  const active = $('#active-scripts'), archived = $('#archived-scripts');
  active.replaceChildren(); archived.replaceChildren();
  for (const script of state.catalog) {
    if (state.deleted.includes(script.id)) continue;
    const stored = state.archived.includes(script.id);
    const li = document.createElement('li'); li.className = 'script-card'; li.dataset.scriptId = script.id;
    const details = document.createElement('div'); details.className = 'script-details';
    const name = document.createElement('strong'); name.textContent = script.name;
    const sites = document.createElement('p'); sites.className = 'script-sites';
    sites.textContent = [...new Set(script.matches.map(pattern => new URL(pattern.replace('://*.', '://')).host))].join(' · ');
    details.append(name, sites);
    const actions = document.createElement('div'); actions.className = 'actions';
    const add = (label, action, className) => {
      const button = document.createElement('button'); button.textContent = label; button.disabled = busy;
      button.className = className; button.setAttribute('aria-label', script.name + ' ' + label);
      button.addEventListener('click', action); actions.append(button);
    };
    if (stored) {
      add('복원', () => mutate('restore', script), 'secondary');
      add('삭제', () => {
        if (busy) return;
        pendingDelete = script; $('#delete-name').textContent = script.name; $('#delete-dialog').showModal();
      }, 'danger');
    } else add('보관함으로 이동', () => {
      if (!busy && window.confirm('“' + script.name + '”을 보관함으로 옮길까요?\n실행 목록에서 빠지며, 보관함에서 다시 복원할 수 있습니다.')) mutate('archive', script);
    }, 'secondary');
    li.append(details, actions); (stored ? archived : active).append(li);
  }
  for (const [key, list] of [['active', active], ['archived', archived]]) {
    $('#' + key + '-count').textContent = list.children.length + '개';
    $('#' + key + '-empty').hidden = !!list.children.length;
  }
  $('#confirm-delete').disabled = busy;
}
async function refresh() {
  const current = ++revision;
  try {
    const value = await request('scripts:state');
    if (revision === current) { state = value; render(); }
  } catch (error) { if (revision === current) status(error.message, true); }
}
async function mutate(action, script) {
  if (busy) return;
  busy = true; render();
  try {
    const value = await request('scripts:' + action, { id: script.id });
    ++revision; state = value;
    if (action === 'delete') { $('#delete-dialog').close(); pendingDelete = null; }
    status('“' + script.name + '”' + ({ archive: '을 보관함으로 옮겼습니다.', restore: '을 실행 목록에 복원했습니다.', delete: '을 보관함에서 삭제했습니다.' }[action]));
  } catch (error) { status(error.message, true); }
  finally { busy = false; render(); }
}
$('#cancel-delete').addEventListener('click', () => { if (!busy) { $('#delete-dialog').close(); pendingDelete = null; } });
$('#delete-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); else pendingDelete = null; });
$('#confirm-delete').addEventListener('click', () => { if (pendingDelete) mutate('delete', pendingDelete); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.macroStudioScriptLibrary || changes.macroStudioLocalScripts)) refresh();
});
await refresh();
if (!$('#library-status').dataset.error || $('#library-status').dataset.error === 'false') status('사용 중인 스크립트를 보관하거나, 보관한 항목을 복원·삭제할 수 있습니다.');
