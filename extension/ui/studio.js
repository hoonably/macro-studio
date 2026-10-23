import { agentPrompt, exportRecording, MAX_STEPS } from '../recorder/model.js';
const $ = selector => document.querySelector(selector);
let recording = null, active = null;
const status = (message, error = false) => { $('#status').textContent = message; $('#status').dataset.error = error; };
async function request(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) throw new Error(response?.error || '확장 프로그램 응답이 없습니다.');
  return response.value;
}
function sitePattern(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('일반 웹사이트 주소를 입력하세요.');
  return url.origin + '/*';
}
async function refreshTab() {
  [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  $('#site').textContent = active?.url ? (() => { try { return new URL(active.url).origin; } catch { return active.url; } })() : '웹사이트에서 도구모음의 Macro Studio 아이콘을 눌러주세요.';
}
const payload = () => ({ ...recording, name: $('#name').value || recording.name });
function updatePreview() {
  $('#preview').value = recording ? agentPrompt(payload(), { goal: $('#goal').value, variables: $('#variables').value }) : '';
}
function render(state) {
  recording = state;
  const busy = state?.status === 'recording';
  $('#start').disabled = !!busy;
  $('#stop').disabled = !busy;
  $('#allow').disabled = !!busy;
  $('#name').disabled = !!busy;
  $('#prompt').disabled = $('#download').disabled = !state?.steps.length || !!busy;
  $('#clear').disabled = !state || !!busy;
  $('#count').textContent = (state?.steps.length || 0) + '단계';
  $('#empty').hidden = !!state?.steps.length;
  $('#steps').replaceChildren();
  for (const [index, step] of (state?.steps || []).entries()) {
    const li = document.createElement('li'); li.className = 'step';
    const title = document.createElement('div'); title.className = 'step-title';
    title.textContent = (index + 1) + '. ' + ({ click: '클릭', input: '입력', change: '변경', navigation: '화면 이동', submit: '제출' }[step.action] || step.action) + ' · ' + (step.target.label || step.target.sapField || step.target.name || step.target.tag || '페이지');
    const url = document.createElement('div'); url.className = 'step-url'; url.textContent = step.page.url + (step.frameId ? ' · iframe' : '');
    const value = document.createElement('div'); value.className = 'step-value'; value.textContent = step.mode === 'variable' ? '변수: ' + (step.variable || '이름을 입력하세요') : String(step.value);
    const controls = document.createElement('div'); controls.className = 'step-controls';
    const select = document.createElement('select'); select.setAttribute('aria-label', '단계 ' + (index + 1) + ' 모드');
    for (const [key, label] of [['fixed', '고정'], ['variable', '변수'], ['manual', '수동']]) { const option = document.createElement('option'); option.value = key; option.textContent = label; select.append(option); }
    select.value = step.mode; select.disabled = !!busy;
    const variable = document.createElement('input'); variable.value = step.variable; variable.placeholder = '변수 이름'; variable.setAttribute('aria-label', '변수 이름'); variable.disabled = !!busy || step.mode !== 'variable';
    const remove = document.createElement('button'); remove.textContent = '삭제'; remove.disabled = !!busy;
    const save = async () => {
      try { render(await request('recording:edit', { id: step.id, mode: select.value, variable: variable.value })); }
      catch (error) { status(error.message, true); }
    };
    select.addEventListener('change', save); variable.addEventListener('change', save);
    remove.addEventListener('click', async () => { try { render(await request('recording:edit', { id: step.id, remove: true })); } catch (error) { status(error.message, true); } });
    controls.append(select, variable, remove); li.append(title, url, value, controls); $('#steps').append(li);
  }
  updatePreview();
  if (busy) status('● 기록 중 · 웹페이지에서 평소 작업을 진행하세요. ' + state.steps.length + '/' + MAX_STEPS + '단계');
  else if (state?.status === 'error') status(state.error || '기록 연결에 실패했습니다.', true);
  else if (state) status(state.note || '기록을 끝냈습니다. 값을 확인하고 에이전트에게 전달하세요.');
}
$('#allow').addEventListener('click', async () => {
  try {
    if (!active?.url) throw new Error('웹사이트에서 도구모음의 Macro Studio 아이콘을 눌러주세요.');
    const origins = [...new Set([sitePattern(active.url), ...$('#frame-sites').value.split(/[\s,]+/).filter(Boolean).map(sitePattern)])];
    // Request immediately within the button's user gesture.
    if (!await chrome.permissions.request({ origins })) throw new Error('사이트 접근이 허용되지 않았습니다.');
    await request('studio:activate', { tabId: active.id });
    status('이 사이트에서 사용할 수 있습니다. 새 기록을 시작하세요.');
  } catch (error) { status(error.message, true); }
});
$('#start').addEventListener('click', async () => {
  $('#start').disabled = true;
  try {
    await refreshTab();
    if (!active?.id) throw new Error('기록할 웹페이지를 열어주세요.');
    render(await request('recording:start', { tabId: active.id, name: $('#name').value }));
  } catch (error) { status(error.message, true); $('#start').disabled = false; }
});
$('#stop').addEventListener('click', async () => {
  $('#stop').disabled = true;
  try {
    const state = await request('studio:state');
    const frames = [...new Set([0, ...(state?.steps || []).map(step => step.frameId)])];
    await Promise.allSettled(frames.map(frameId => chrome.tabs.sendMessage(state.tabId, { type: 'capture:flush' }, { frameId })));
    render(await request('recording:stop'));
  } catch (error) { status(error.message, true); $('#stop').disabled = false; }
});
$('#prompt').addEventListener('click', async () => {
  updatePreview();
  try { await navigator.clipboard.writeText($('#preview').value); status('복사했습니다. 저장소를 연 Codex 또는 Claude Code에 붙여 넣으세요.'); }
  catch { $('#preview').closest('details').open = true; $('#preview').focus(); $('#preview').select(); status('미리보기에서 직접 복사하세요.'); }
});
$('#download').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(exportRecording(payload()), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'macro-studio-recording.json'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('#clear').addEventListener('click', async () => { try { render(await request('recording:clear')); status('현재 기록을 지웠습니다.'); } catch (error) { status(error.message, true); } });
for (const selector of ['#name', '#goal', '#variables']) $(selector).addEventListener('input', updatePreview);
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'session' && changes.macroStudioRecording) render(changes.macroStudioRecording.newValue || null); });
chrome.tabs.onActivated.addListener(() => refreshTab().catch(() => {}));
chrome.tabs.onUpdated.addListener((tabId, change) => { if (tabId === active?.id && change.url) refreshTab().catch(() => {}); });
await refreshTab();
try {
  const initial = await request('studio:state');
  if (initial?.name) $('#name').value = initial.name;
  render(initial);
} catch (error) { status(error.message, true); }
