const $ = selector => document.querySelector(selector);
const acknowledgment = $('#reset-ack'), button = $('#confirm-reset'), result = $('#reset-result');
let ready = false, pending = false;
async function request(type, values = {}) {
  const reply = await chrome.runtime.sendMessage({ type, ...values });
  if (!reply?.ok) throw new Error(reply?.error || '확장 프로그램 응답이 없습니다.');
  return reply.value;
}
function controls() { acknowledgment.disabled = !ready || pending; button.disabled = !ready || pending || !acknowledgment.checked; }
acknowledgment.addEventListener('change', controls);
button.addEventListener('click', async () => {
  if (!ready || pending || !acknowledgment.checked) return;
  pending = true; controls(); result.textContent = '기록과 개인 설정을 지우는 중…';
  try {
    await request('reset:confirm', { confirmed: true });
    ready = false;
    $('#reset-summary').textContent = '작업 기록 0개 · 스크립트 0개 · 연결한 폴더 없음 · 사이트 설정 0개';
    result.textContent = '초기화했습니다. 열려 있는 웹페이지와 작업실을 새로고침한 뒤 시작하세요.';
  } catch (error) { result.textContent = error.message; }
  finally { pending = false; controls(); }
});
try {
  const state = await request('reset:state');
  $('#reset-summary').textContent = `작업 기록 ${state.steps}개${state.recording ? ' (기록 중)' : ''} · 스크립트 ${state.scripts}개 · ${state.connected ? '연결한 폴더 있음' : '연결한 폴더 없음'} · 사이트 설정 ${state.sites}개`;
  ready = !state.running;
  if (state.running) result.textContent = '실행 중인 매크로가 끝난 뒤 이 화면을 새로고침하세요.';
} catch (error) { result.textContent = error.message; }
controls();
