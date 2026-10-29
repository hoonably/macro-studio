import { agentPrompt, exportRecording, MAX_STEPS } from '../recorder/model.js';
import { sitePattern } from '../recorder/frames.js';
import { STORE_BUILD } from '../core/distribution.js';
const $ = selector => document.querySelector(selector);
const DRAFT_KEY = 'macroStudioStudioDraft';
let draftWrites = Promise.resolve(), restoringDraft = true;
const updateLocked = [];
function saveDraft() {
  if (restoringDraft) return draftWrites;
  const draft = Object.fromEntries(['name', 'goal', 'variables'].map(id => [id, $('#' + id).value]));
  draftWrites = draftWrites.catch(() => {}).then(() => chrome.storage.session.set({ [DRAFT_KEY]: draft }));
  return draftWrites;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === 'studio:reset') {
    restoringDraft = true;
    draftWrites.catch(() => {}).then(() => {
      $('#name').value = '나의 자동화'; $('#goal').value = $('#variables').value = '';
      updatePreview(); restoringDraft = false; respond({ saved: true });
    });
    return true;
  }
  if (message.type === 'update:prepare') {
    for (const id of ['name', 'goal', 'variables']) if (!$('#' + id).disabled) {
      $('#' + id).disabled = true; updateLocked.push($('#' + id));
    }
    saveDraft().then(() => respond({ saved: true }), () => respond({ saved: false }));
    return true;
  }
  if (message.type === 'update:cancel') while (updateLocked.length) updateLocked.pop().disabled = false;
});
let recording = null, active = null;
let frameInfo = null, frameSignature = '', frameRequest = 0, framePending = false, permissionBusy = false;
const selectedFrames = new Set();
const targetTabId = () => recording?.status === 'recording' ? recording.tabId : active?.id;
const status = (message, error = false) => { $('#status').textContent = message; $('#status').dataset.error = error; };
async function request(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || '확장 프로그램 응답이 없습니다.');
  return response.value;
}
async function refreshTab() {
  const previous = active;
  [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (recording?.status !== 'recording' && (previous?.id !== active?.id || previous?.url !== active?.url)) {
    ++frameRequest; framePending = false;
    clearFrames('현재 사이트를 확인하는 중…');
  }
  $('#site').textContent = active?.url ? (() => { try { return new URL(active.url).origin; } catch { return active.url; } })() : '웹사이트에서 도구모음의 Macro Studio 아이콘을 눌러주세요.';
}
function clearFrames(message, error = false) {
  frameInfo = null; frameSignature = ''; selectedFrames.clear();
  $('#frame-sites').replaceChildren();
  $('#frame-status').textContent = message; $('#frame-status').dataset.error = String(error);
  permissionControls();
}
function permissionControls() {
  const current = frameInfo?.tabId === targetTabId() ? frameInfo : null;
  $('#allow').disabled = permissionBusy || !Number.isInteger(targetTabId());
  $('#allow').textContent = current?.topAllowed ? current.detectionEnabled ? '기록기 다시 연결' : '내부 화면 자동 감지 켜기' : '이 사이트에서 사용하기';
  $('#start').disabled = permissionBusy || recording?.status === 'recording' || !current?.topAllowed;
  const missing = (current?.frames || []).filter(frame => !frame.allowed);
  $('#allow-frames').hidden = !missing.length;
  $('#allow-frames').disabled = permissionBusy || !missing.some(frame => selectedFrames.has(frame.pattern));
  for (const checkbox of $('#frame-sites').querySelectorAll('input')) checkbox.disabled = permissionBusy;
}
function renderFrames(info) {
  if (frameInfo?.tabId !== info.tabId || frameInfo?.origin !== info.origin) selectedFrames.clear();
  const missing = info.frames.filter(frame => !frame.allowed);
  for (const pattern of selectedFrames) if (!missing.some(frame => frame.pattern === pattern)) selectedFrames.delete(pattern);
  frameInfo = info;
  const signature = JSON.stringify(info);
  if (signature !== frameSignature) {
    frameSignature = signature;
    $('#frame-sites').replaceChildren();
    for (const frame of info.frames) {
      const li = document.createElement('li'), text = document.createElement('span');
      text.className = 'frame-origin'; text.textContent = frame.origin;
      if (frame.allowed) {
        li.className = 'frame-granted';
        const allowed = document.createElement('small'); allowed.textContent = '이미 허용됨'; li.append(text, allowed);
      } else {
        const label = document.createElement('label'), checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; checkbox.value = frame.pattern; checkbox.checked = selectedFrames.has(frame.pattern);
        checkbox.setAttribute('aria-label', frame.origin + ' 함께 기록');
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) selectedFrames.add(frame.pattern); else selectedFrames.delete(frame.pattern);
          permissionControls();
        });
        label.append(checkbox, text); li.append(label);
      }
      $('#frame-sites').append(li);
    }
  }
  const text = !info.detectionEnabled ? '한 번 켜두면 내부 화면 주소를 자동으로 확인합니다. 주소를 직접 입력할 필요가 없습니다.' :
    missing.length ? '아직 허용하지 않은 내부 사이트 ' + missing.length + '곳을 발견했습니다. 기록할 화면만 선택하세요. 광고 등은 선택하지 않아도 됩니다.' :
    info.frames.length ? '발견한 내부 사이트는 모두 허용되어 있습니다. 추가 권한 요청 없이 기록할 수 있습니다.' : '추가 권한이 필요한 내부 화면이 없습니다.';
  if ($('#frame-status').textContent !== text) $('#frame-status').textContent = text;
  $('#frame-status').dataset.error = 'false';
  $('#site').textContent = (recording?.status === 'recording' ? '기록 중인 탭 · ' : '') + info.origin;
  permissionControls();
}
async function refreshFrames(force = false) {
  const tabId = targetTabId();
  if (!Number.isInteger(tabId) || (framePending && !force)) return;
  const current = ++frameRequest; framePending = true;
  try {
    const info = await request('frames:scan', { tabId });
    if (current === frameRequest && tabId === targetTabId()) renderFrames(info);
  } catch (error) {
    if (current === frameRequest) clearFrames(error.message, true);
  } finally { if (current === frameRequest) framePending = false; }
}
const payload = () => ({ ...recording, name: $('#name').value || recording.name });
function updatePreview() {
  $('#preview').value = recording ? agentPrompt(payload(), { goal: $('#goal').value, variables: $('#variables').value, standalone: STORE_BUILD }) : '';
}
function render(state) {
  recording = state;
  const busy = state?.status === 'recording';
  $('#stop').disabled = !busy;
  $('#name').disabled = !!busy;
  $('#prompt').disabled = $('#download').disabled = !state?.steps.length || !!busy;
  $('#clear').disabled = !state || !!busy;
  $('#count').textContent = (state?.steps.length || 0) + '단계';
  $('#empty').hidden = !!state?.steps.length;
  $('#steps').replaceChildren();
  for (const [index, step] of (state?.steps || []).entries()) {
    const li = document.createElement('li'); li.className = 'step';
    const content = document.createElement('div'); content.className = 'step-content';
    const title = document.createElement('div'); title.className = 'step-title';
    title.textContent = (index + 1) + '. ' + ({ click: '클릭', input: '입력', change: '변경', navigation: '화면 이동', submit: '제출' }[step.action] || step.action) + ' · ' + (step.target.label || step.target.sapField || step.target.name || step.target.tag || '페이지');
    const url = document.createElement('div'); url.className = 'step-url'; url.textContent = step.page.url + (step.frameId ? ' · iframe' : '');
    const value = document.createElement('div'); value.className = 'step-value'; value.textContent = step.mode === 'variable' ? '실행할 때 입력: ' + (step.variable || step.target.label || '값') : String(step.value);
    const remove = document.createElement('button'); remove.className = 'step-delete'; remove.textContent = '삭제'; remove.disabled = !!busy;
    remove.setAttribute('aria-label', '단계 ' + (index + 1) + ' 삭제');
    remove.addEventListener('click', async () => { try { render(await request('recording:edit', { id: step.id, remove: true })); } catch (error) { status(error.message, true); } });
    content.append(title, url, value); li.append(content, remove); $('#steps').append(li);
  }
  updatePreview();
  permissionControls();
  if (busy) status('● 기록 중 · 웹페이지에서 평소 작업을 진행하세요. ' + state.steps.length + '/' + MAX_STEPS + '단계' + (state.note ? '\n' + state.note : ''));
  else if (state?.status === 'error') status(state.error || '기록 연결에 실패했습니다.', true);
  else if (state) status(state.note || '기록을 끝냈습니다. 값을 확인하고 에이전트에게 전달하세요.');
}
$('#allow').addEventListener('click', async () => {
  const tabId = targetTabId();
  try {
    const current = frameInfo?.tabId === tabId ? frameInfo : null;
    const pattern = current?.pattern || (active?.id === tabId && active.url ? sitePattern(active.url) : null);
    if (!pattern) throw new Error('웹사이트에서 도구모음의 Macro Studio 아이콘을 눌러주세요.');
    permissionBusy = true; permissionControls();
    const permissions = current?.detectionEnabled ? [] : ['webNavigation'];
    const origins = current?.topAllowed ? [] : [pattern];
    // No asynchronous work precedes this call: Chrome requires the actual click gesture.
    if ((permissions.length || origins.length) && !await chrome.permissions.request({ origins, permissions })) throw new Error('요청한 권한이 허용되지 않았습니다. 기존에 허용한 화면은 계속 기록할 수 있습니다.');
    const result = await request('studio:activate', { tabId, origin: pattern.slice(0, -2) });
    status(result.failed ? '일부 내부 화면에 연결하지 못했습니다. 화면이 준비된 후 기록기 다시 연결을 눌러주세요.' : recording?.status === 'recording' ? '새로 허용한 화면도 이어서 기록합니다.' : '이 사이트에서 사용할 수 있습니다. 내부 화면을 확인하고 새 기록을 시작하세요.', !!result.failed);
    await refreshFrames(true);
  } catch (error) { status(error.message, true); }
  finally { permissionBusy = false; permissionControls(); }
});
$('#allow-frames').addEventListener('click', async () => {
  const current = frameInfo, tabId = targetTabId();
  if (permissionBusy || current?.tabId !== tabId) return;
  const origins = current.frames.filter(frame => !frame.allowed && selectedFrames.has(frame.pattern)).map(frame => frame.pattern);
  if (!origins.length) return;
  permissionBusy = true; permissionControls();
  try {
    if (!await chrome.permissions.request({ origins })) throw new Error('선택한 내부 화면 접근이 허용되지 않았습니다. 기존에 허용한 화면은 계속 기록할 수 있습니다.');
    const result = await request('studio:activate', { tabId, origin: current.origin });
    status(result.failed ? '일부 내부 화면에 연결하지 못했습니다. 화면이 준비된 후 기록기 다시 연결을 눌러주세요.' : '선택한 내부 화면을 연결했습니다. 허용한 주소는 다음에도 다시 묻지 않습니다.', !!result.failed);
    await refreshFrames(true);
  } catch (error) { status(error.message, true); }
  finally { permissionBusy = false; permissionControls(); }
});
$('#start').addEventListener('click', async () => {
  $('#start').disabled = true;
  try {
    await refreshTab();
    if (!active?.id) throw new Error('기록할 웹페이지를 열어주세요.');
    render(await request('recording:start', { tabId: active.id, name: $('#name').value }));
    await refreshFrames(true);
  } catch (error) { status(error.message, true); permissionControls(); }
});
$('#stop').addEventListener('click', async () => {
  $('#stop').disabled = true;
  try {
    const state = await request('studio:state');
    const frames = [...new Set([0, ...(state?.steps || []).map(step => step.frameId)])];
    await Promise.allSettled(frames.map(frameId => chrome.tabs.sendMessage(state.tabId, { type: 'capture:flush' }, { frameId })));
    render(await request('recording:stop'));
    await refreshFrames(true);
  } catch (error) { status(error.message, true); $('#stop').disabled = false; }
});
$('#prompt').addEventListener('click', async () => {
  updatePreview();
  try { await navigator.clipboard.writeText($('#preview').value); status(STORE_BUILD ? '복사했습니다. 개인 스크립트를 저장할 폴더를 연 코딩 에이전트에 붙여 넣으세요.' : '복사했습니다. 저장소를 연 Codex 또는 Claude Code에 붙여 넣으세요.'); }
  catch { $('#preview').focus(); $('#preview').select(); status('미리보기에서 직접 복사하세요.'); }
});
$('#download').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(exportRecording(payload()), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'macro-studio-recording.json'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('#clear').addEventListener('click', async () => { try { render(await request('recording:clear')); status('현재 기록을 지웠습니다.'); } catch (error) { status(error.message, true); } });
for (const selector of ['#name', '#goal', '#variables']) $(selector).addEventListener('input', () => {
  updatePreview(); saveDraft().catch(error => status(error.message, true));
});
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'session' && changes.macroStudioRecording) render(changes.macroStudioRecording.newValue || null); });
chrome.tabs.onActivated.addListener(() => refreshTab().then(() => refreshFrames(true)).catch(() => {}));
chrome.tabs.onUpdated.addListener((tabId, change) => { if (tabId === active?.id && (change.url || change.status === 'complete')) refreshTab().then(() => refreshFrames(true)).catch(() => {}); });
chrome.permissions.onAdded.addListener(() => refreshFrames(true));
chrome.permissions.onRemoved.addListener(() => refreshFrames(true));
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'hidden') refreshFrames(true); });
setInterval(() => { if (document.visibilityState !== 'hidden' && !permissionBusy) refreshFrames(); }, 1500);
await refreshTab();
try {
  const initial = await request('studio:state');
  if (initial?.name) $('#name').value = initial.name;
  render(initial);
} catch (error) { status(error.message, true); }
await refreshFrames(true);
try {
  const draft = (await chrome.storage.session.get(DRAFT_KEY))[DRAFT_KEY];
  for (const id of ['name', 'goal', 'variables']) if (typeof draft?.[id] === 'string') $('#' + id).value = draft[id];
  updatePreview();
} catch { /* Recording data remains available even if draft storage is unavailable. */ }
restoringDraft = false;
