const $ = id => document.getElementById(id);
const id = new URLSearchParams(location.search).get('recording');
let state = null, busy = false;
const say = (text, error = false) => { $('status').textContent = text; $('status').dataset.error = String(error); };
async function request(type) {
  const response = await chrome.runtime.sendMessage({ type, id });
  if (!response?.ok) throw new Error(response?.error || '기록 상태를 확인하지 못했어요.');
  return response.value;
}
async function refresh() {
  try {
    state = await request('recording:permissions');
    $('origins').replaceChildren();
    for (const origin of state.origins) { const li = document.createElement('li'); li.textContent = origin; $('origins').append(li); }
    $('grant').disabled = busy || !state.active || !state.origins.length;
    $('stop').disabled = busy || !state.active;
    if (!state.active || !state.origins.length) {
      $('description').textContent = state.error || (state.active ? '내부 사이트 접근이 확인되어 기록을 이어갑니다.' : '이 기록은 이미 끝났어요.');
      say('이 창을 닫아도 됩니다.');
    } else if (!busy) say('');
  } catch (error) { say(error.message, true); $('grant').disabled = $('stop').disabled = true; }
}
$('grant').addEventListener('click', async () => {
  if (busy || !state?.active || !state.origins.length) return;
  const origins = state.origins.map(origin => origin + '/*');
  busy = true; $('grant').disabled = $('stop').disabled = true;
  let failure = '';
  try {
    // Chrome's permission prompt must be opened directly by this click.
    if (!await chrome.permissions.request({ origins })) throw new Error('접근을 허용해야 기록을 이어갈 수 있어요. 기존 기록은 보존됩니다.');
    await refresh(); // Recheck current frames, not just the previously shown addresses.
  } catch (error) { failure = error.message; }
  finally { busy = false; await refresh(); if (failure) say(failure, true); }
});
$('stop').addEventListener('click', async () => {
  if (busy || !state?.active) return;
  busy = true;
  try { await request('recording:stop'); }
  catch (error) { say(error.message, true); busy = false; }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.macroStudioRecording && !busy) refresh();
});
refresh();
