const $ = selector => document.querySelector(selector);
let state = { catalog: [], archived: [], deleted: [] }, busy = false, pendingDelete = null, revision = 0;
let signature = '', selectedTab = 'active', undo = null;
const status = (text, error = false) => { $('#library-status').textContent = text; $('#library-status').dataset.error = String(error); };
async function request(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || '확장 프로그램 응답이 없습니다.');
  return response.value;
}
function controls() {
  for (const button of document.querySelectorAll('.script-card button, #confirm-delete, #undo-archive, #library-sync')) button.disabled = busy;
  $('#undo-archive').hidden = !undo || !state.archived.includes(undo.id) || state.deleted.includes(undo.id);
}
function filter() {
  const query = $('#script-search').value.trim().toLocaleLowerCase();
  for (const key of ['active', 'archived']) {
    const cards = [...$('#' + key + '-scripts').children];
    for (const card of cards) card.hidden = !card.dataset.search.includes(query);
    $('#' + key + '-empty').hidden = !!cards.length;
    $('#' + key + '-panel').hidden = key !== selectedTab;
    const tab = $('#' + key + '-tab');
    tab.setAttribute('aria-selected', String(key === selectedTab)); tab.tabIndex = key === selectedTab ? 0 : -1;
  }
  const cards = [...$('#' + selectedTab + '-scripts').children];
  $('#search-empty').hidden = !cards.length || cards.some(card => !card.hidden);
}
function render() {
  const next = JSON.stringify(state);
  if (next !== signature) {
    signature = next;
    const active = $('#active-scripts'), archived = $('#archived-scripts');
    active.replaceChildren(); archived.replaceChildren();
    for (const script of state.catalog) {
      if (state.deleted.includes(script.id)) continue;
      const stored = state.archived.includes(script.id);
      const li = document.createElement('li'); li.className = 'script-card'; li.dataset.scriptId = script.id;
      const details = document.createElement('div'); details.className = 'script-details';
      const name = document.createElement('strong'); name.textContent = script.name;
      const sites = document.createElement('p'); sites.className = 'script-sites';
      sites.textContent = [...new Set((script.matches || []).map(pattern => { try { return new URL(pattern.replace('://*.', '://')).host; } catch { return pattern; } }))].join(' · ');
      details.append(name, sites);
      if (script.unavailable) {
        const link = document.createElement('a'); link.href = 'scripts.html'; link.textContent = '권한 확인 필요 →'; details.append(link);
      }
      li.dataset.search = (script.name + ' ' + sites.textContent).toLocaleLowerCase();
      const actions = document.createElement('div'); actions.className = 'actions';
      const add = (label, action, className) => {
        const button = document.createElement('button'); button.textContent = label;
        button.className = className; button.setAttribute('aria-label', script.name + ' ' + label);
        button.addEventListener('click', action); actions.append(button);
      };
      if (stored) {
        add('복원', () => mutate('restore', script), 'secondary');
        add('삭제', () => {
          if (busy) return;
          pendingDelete = script; $('#delete-name').textContent = script.name; $('#delete-dialog').showModal();
        }, 'text-button');
      } else add('보관', () => mutate('archive', script), 'secondary');
      li.append(details, actions); (stored ? archived : active).append(li);
    }
    for (const [key, list] of [['active', active], ['archived', archived]]) $('#' + key + '-count').textContent = list.children.length + '개';
  }
  filter(); controls();
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
  busy = true; controls();
  try {
    const value = await request('scripts:' + action, { id: script.id });
    ++revision; state = value; undo = action === 'archive' ? script : null;
    if (action === 'delete') { $('#delete-dialog').close(); pendingDelete = null; }
    status('“' + script.name + '”' + ({ archive: ' 보관됨', restore: ' 복원됨', delete: ' 목록에서 삭제됨' }[action]));
  } catch (error) { status(error.message, true); }
  finally { busy = false; render(); }
}
for (const key of ['active', 'archived']) {
  const tab = $('#' + key + '-tab');
  tab.addEventListener('click', () => { selectedTab = key; filter(); });
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    selectedTab = event.key === 'Home' ? 'active' : event.key === 'End' ? 'archived' : selectedTab === 'active' ? 'archived' : 'active';
    filter(); $('#' + selectedTab + '-tab').focus();
  });
}
$('#script-search').addEventListener('input', filter);
$('#undo-archive').addEventListener('click', () => { if (undo) mutate('restore', undo); });
$('#library-sync').addEventListener('click', async () => {
  if (busy) return;
  busy = true; controls();
  try {
    const result = await request('local:sync'); await refresh();
    status(result.error || (result.errors?.length ? '파일 오류가 있습니다. 폴더·권한 설정에서 확인하세요.' : !result.connected ? '폴더·권한 설정에서 사용 폴더를 연결하세요.' : !result.readable ? '폴더·권한 설정에서 폴더 읽기를 다시 허용하세요.' : !result.enabled ? '폴더·권한 설정에서 Chrome 실행을 허용하세요.' : '파일 반영을 확인했습니다.'), !!result.error || !!result.errors?.length);
  } catch (error) { status(error.message, true); }
  finally { busy = false; controls(); }
});
$('#cancel-delete').addEventListener('click', () => { if (!busy) { $('#delete-dialog').close(); pendingDelete = null; } });
$('#delete-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); else pendingDelete = null; });
$('#confirm-delete').addEventListener('click', () => { if (pendingDelete) mutate('delete', pendingDelete); });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.macroStudioScriptLibrary || changes.macroStudioLocalScripts)) refresh();
});
await refresh();
if ($('#library-status').dataset.error !== 'true') status('');
