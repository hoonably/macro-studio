import { scriptsDirectory } from '../scripts/directory.js';
import { readLocal, writeLocal } from '../scripts/store.js';
import { STORE_BUILD } from '../core/distribution.js';
const $ = selector => document.querySelector(selector);
let folder = await readLocal('folder'), folderEpoch = await readLocal('resetEpoch'), state = null, pending = false, signature = '';
const checked = new Set();
const say = (message, error = false) => { $('#script-state').textContent = message; $('#script-state').dataset.error = String(error); };
async function request(type, payload = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...payload });
  if (!result?.ok) throw new Error(result?.error || '확장 프로그램 응답이 없습니다.');
  return result.value;
}
function render(next) {
  state = next;
  const readiness = [
    { title: '폴더 읽기', ready: next.connected && next.readable, detail: next.connected ? (next.readable ? '선택한 폴더만 읽습니다' : '읽기 권한을 다시 허용하세요') : '사용할 폴더를 선택하세요' },
    { title: '스크립트 실행', ready: !!next.enabled, detail: next.enabled ? 'Chrome 실행 허용 완료' : 'Chrome 설정에서 한 번 허용하세요' },
    { title: '사이트 접근', ready: !!next.count && !(next.missingOrigins || []).length, detail: (next.missingOrigins || []).length ? '아래에서 사용할 주소만 허용하세요' : next.count ? '필요한 사이트가 허용됐습니다' : '스크립트를 연결하면 확인합니다' }
  ];
  const checklist = $('#setup-checklist');
  if (checklist) {
    checklist.replaceChildren();
    readiness.forEach((item, index) => {
      const row = document.createElement('li'), marker = document.createElement('span'), copy = document.createElement('div'), title = document.createElement('strong'), detail = document.createElement('small');
      row.dataset.ready = String(!!item.ready); marker.className = 'setup-marker'; marker.textContent = item.ready ? '✓' : String(index + 1); marker.setAttribute('aria-hidden', 'true');
      title.textContent = item.title + (item.ready ? ' · 완료' : ''); detail.textContent = item.detail;
      copy.append(title, detail); row.append(marker, copy); checklist.append(row);
    });
  }
  $('#script-permission-setup').hidden = !next.connected || next.enabled;
  $('#connect-folder').disabled = pending || typeof window.showDirectoryPicker !== 'function';
  $('#connect-folder').textContent = next.connected ? '다른 폴더 연결' : '스크립트 폴더 연결';
  $('#grant-folder').hidden = !next.connected || next.readable;
  $('#grant-folder').disabled = pending;
  $('#disconnect-folder').hidden = !next.connected;
  $('#disconnect-folder').disabled = $('#sync-folder').disabled = pending;
  $('#sync-folder').textContent = next.connected ? '지금 동기화' : '다시 확인';
  if (!next.connected && !next.count) say(STORE_BUILD ? '스크립트가 준비되면 ‘스크립트 폴더 연결’에서 scripts 폴더를 선택하세요. 기록은 폴더 연결 없이 시작할 수 있습니다.' : '‘스크립트 폴더 연결’을 누른 뒤 macro-studio 폴더를 선택하세요. 필요한 설정은 이어서 안내합니다.');
  else if (!next.enabled) say('폴더는 연결됐습니다. 아래에서 Chrome 실행 허용을 한 번 켜면 준비가 끝납니다.');
  else if (next.connected && !next.readable) say('폴더 읽기 권한을 다시 허용하면 동기화가 이어집니다.');
  else if (next.error) say(next.error + '\n' + next.message, true);
  else if (next.connected) say(next.folderName + ' · ' + next.count + '개 · ' + (next.message || '자동 동기화 중'));
  else say(next.count ? '자동 동기화가 꺼져 있습니다. 마지막으로 가져온 ' + next.count + '개는 계속 사용할 수 있습니다.' : '스크립트 폴더를 연결하면 준비가 끝납니다.');
  $('#sync-detail').textContent = next.syncedAt ? '마지막 반영: ' + new Date(next.syncedAt).toLocaleString() : '';
  $('#sync-errors').replaceChildren();
  for (const error of [...(next.errors || []), ...(next.runtimeErrors || [])]) { const li = document.createElement('li'); li.textContent = error.id + ' · ' + error.message; $('#sync-errors').append(li); }
  const origins = next.missingOrigins || [];
  $('#script-origins-section').hidden = !origins.length;
  if (JSON.stringify(origins) !== signature) {
    signature = JSON.stringify(origins); $('#script-origins').replaceChildren();
    for (const origin of origins) {
      const li = document.createElement('li'), label = document.createElement('label'), checkbox = document.createElement('input'), text = document.createElement('span');
      checkbox.type = 'checkbox'; checkbox.value = origin; checkbox.checked = checked.has(origin);
      text.textContent = origin.replace(/\/\*$/, ''); text.className = 'frame-origin';
      checkbox.addEventListener('change', () => { checkbox.checked ? checked.add(origin) : checked.delete(origin); permissionsControl(); });
      label.append(checkbox, text); li.append(label); $('#script-origins').append(li);
    }
  }
  $('#synced-count').textContent = next.count + '개';
  $('#synced-empty').hidden = !!next.count;
  $('#synced-scripts').replaceChildren();
  for (const script of next.scripts || []) {
    const li = document.createElement('li'), name = document.createElement('strong'), sites = document.createElement('small');
    name.textContent = script.name; sites.textContent = script.matches.join(' · '); li.append(name, sites); $('#synced-scripts').append(li);
  }
  permissionsControl();
}
function permissionsControl() {
  $('#grant-script-origins').disabled = pending || !(state?.missingOrigins || []).some(origin => checked.has(origin));
  for (const input of $('#script-origins').querySelectorAll('input')) input.disabled = pending;
}
async function refresh(sync = false) {
  if (pending) return;
  pending = true; if (state) render(state);
  try { folder = await readLocal('folder'); folderEpoch = await readLocal('resetEpoch'); render(await request(sync ? 'local:sync' : 'local:status')); }
  catch (error) { say(error.message, true); }
  finally { pending = false; if (state) { $('#connect-folder').disabled = typeof window.showDirectoryPicker !== 'function'; $('#sync-folder').disabled = $('#grant-folder').disabled = $('#disconnect-folder').disabled = false; permissionsControl(); } }
}
$('#script-settings').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/?id=' + chrome.runtime.id }));
async function reloadExtension() {
  try {
    const recording = await request('studio:state'), current = await request('local:status');
    if (recording?.status === 'recording' || current.running) throw new Error('기록을 끝내거나 실행 중인 작업이 완료되면 업데이트를 적용할 수 있습니다.');
    try {
      const result = await request('update:reload');
      if (!result.applying) say('진행 중인 작업이 끝나면 업데이트를 적용합니다.');
    } catch (error) {
      if (!error.message.includes('지원하지 않는 요청')) throw error;
      // Bootstrap versions that predate build detection without discarding records.
      if (recording?.steps?.length) throw new Error('이번 첫 업데이트 전에는 현재 기록을 복사·저장해 주세요. 이후부터는 기록을 유지하며 자동 적용합니다.');
      const tab = await chrome.tabs.getCurrent();
      if (Number.isInteger(tab?.id)) await chrome.storage.local.set({ macroStudioResumeScriptsTab: tab.id });
      chrome.runtime.reload();
    }
  } catch (error) { say(error.message, true); }
}
$('#apply-script-settings').addEventListener('click', reloadExtension);
$('#reload-extension').addEventListener('click', reloadExtension);
$('#connect-folder').addEventListener('click', async () => {
  // Keep the picker in the actual user gesture. Only the selected scripts directory is retained.
  try {
    const selectedEpoch = folderEpoch;
    const selection = window.showDirectoryPicker({ id: 'macro-studio-scripts', mode: 'read' });
    const selected = await scriptsDirectory(await selection);
    await writeLocal({ folder: selected }, selectedEpoch); folder = selected;
    await refresh(true);
  } catch (error) { if (error.name !== 'AbortError') say(error.message, true); }
});
$('#grant-folder').addEventListener('click', async () => {
  const permission = folder?.requestPermission({ mode: 'read' });
  try { if (await permission !== 'granted') throw new Error('폴더 읽기가 허용되지 않았습니다.'); await refresh(true); }
  catch (error) { say(error.message, true); }
});
$('#sync-folder').addEventListener('click', () => refresh(true));
$('#disconnect-folder').addEventListener('click', async () => { await writeLocal({ folder: undefined }); folder = null; await refresh(true); });
$('#grant-script-origins').addEventListener('click', async () => {
  const origins = (state?.missingOrigins || []).filter(origin => checked.has(origin));
  if (!origins.length || pending) return;
  const permission = chrome.permissions.request({ origins });
  try { if (!await permission) throw new Error('사이트 접근이 허용되지 않았습니다.'); await refresh(true); }
  catch (error) { say(error.message, true); }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') refresh(true); });
setInterval(() => { if (document.visibilityState !== 'hidden') refresh(true); }, 2000);
await refresh(true);
