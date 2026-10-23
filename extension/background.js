import { MAX_STEPS, normalizeEvent } from './recorder/model.js';

const KEY = 'macroStudioRecording';
const CAPTURE_FILES = ['core/namespace.js', 'ui/launcher.js', 'core/studio-entry.js', 'recorder/capture.js'];
let queue = Promise.resolve();
const serial = action => {
  const result = queue.then(action);
  queue = result.catch(() => {});
  return result;
};
const read = async () => (await chrome.storage.session.get(KEY))[KEY] || null;
const write = state => chrome.storage.session.set({ [KEY]: state });
const allowed = (state, sender) => state?.status === 'recording' && sender.tab?.id === state.tabId &&
  state.origins.some(pattern => { try { return new URL(sender.url).origin + '/*' === pattern; } catch { return false; } });
const controlPage = sender => sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL('ui/'));

async function registerCapture() {
  const { origins = [] } = await chrome.permissions.getAll();
  const matches = origins.filter(pattern => /^https?:\/\//.test(pattern));
  const id = 'macro-studio-capture';
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (!matches.length) { if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [id] }); return; }
  const definition = { id, matches, js: CAPTURE_FILES, allFrames: true, runAt: 'document_idle', persistAcrossSessions: true };
  if (registered.length) await chrome.scripting.updateContentScripts([definition]);
  else await chrome.scripting.registerContentScripts([definition]);
}
async function start(message) {
  const previous = await read();
  if (previous?.status === 'recording') throw new Error('이미 기록 중입니다. 먼저 기록을 끝내세요.');
  const tab = await chrome.tabs.get(message.tabId);
  const url = new URL(tab.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('일반 웹사이트에서 기록을 시작하세요.');
  const origin = url.origin + '/*';
  if (!await chrome.permissions.contains({ origins: [origin] })) throw new Error('이 사이트 접근을 먼저 허용하세요.');
  const permissions = await chrome.permissions.getAll();
  // Start with exact granted hosts. Cross-origin frames need their own permission.
  const origins = permissions.origins.filter(item => /^https?:\/\//.test(item) && !item.includes('://*'));
  if (!origins.includes(origin)) origins.push(origin);
  const state = { id: crypto.randomUUID(), schemaVersion: 1, name: String(message.name || '나의 자동화').slice(0, 100),
    status: 'recording', tabId: tab.id, origins, createdAt: new Date().toISOString(), steps: [],
    stopBefore: '최종 제출·결재상신은 사용자가 직접 실행' };
  await registerCapture();
  await write(state);
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: CAPTURE_FILES });
    await chrome.tabs.sendMessage(tab.id, { type: 'capture:state', recordingId: state.id });
  } catch (error) {
    state.status = 'error'; state.error = error.message; await write(state);
    throw new Error('기록기를 연결하지 못했습니다. 페이지를 새로고침하고 다시 시작하세요. ' + error.message);
  }
  return state;
}
async function handle(message, sender) {
  if (message.type === 'capture:status') {
    const state = await read();
    return { recordingId: allowed(state, sender) ? state.id : null };
  }
  if (message.type === 'capture:event') {
    const state = await read();
    if (!allowed(state, sender) || message.recordingId !== state.id) return { ignored: true };
    if (state.steps.length >= MAX_STEPS) return { ignored: true, limit: true };
    const step = normalizeEvent(message.event, { url: sender.url, frameId: sender.frameId });
    if (!step) return { ignored: true };
    state.steps.push({ id: crypto.randomUUID(), at: new Date().toISOString(), ...step });
    if (state.steps.length === MAX_STEPS) {
      state.status = 'stopped'; state.stoppedAt = new Date().toISOString();
      state.note = MAX_STEPS + '단계에 도달해 기록을 끝냈습니다. 필요한 부분으로 나누어 기록하세요.';
      await chrome.tabs.sendMessage(state.tabId, { type: 'capture:state', recordingId: null }).catch(() => {});
    }
    await write(state);
    return { ok: true };
  }
  if (message.type === 'studio:open' && sender.tab && sender.frameId === 0) {
    await chrome.sidePanel.open({ tabId: sender.tab.id });
    return { ok: true };
  }
  if (!controlPage(sender)) throw new Error('확장 프로그램 화면에서 실행하세요.');
  switch (message.type) {
    case 'studio:state': return await read();
    case 'studio:activate':
      await registerCapture();
      await chrome.scripting.executeScript({ target: { tabId: message.tabId, allFrames: true }, files: CAPTURE_FILES });
      return { ok: true };
    case 'recording:start': return await start(message);
    case 'recording:stop': {
      const state = await read();
      if (!state || state.status !== 'recording') return state;
      state.status = 'stopped'; state.stoppedAt = new Date().toISOString();
      await write(state);
      await chrome.tabs.sendMessage(state.tabId, { type: 'capture:state', recordingId: null }).catch(() => {});
      return state;
    }
    case 'recording:edit': {
      const state = await read();
      if (!state || state.status === 'recording') throw new Error('기록을 끝낸 뒤 편집하세요.');
      const step = state.steps.find(item => item.id === message.id);
      if (!step) throw new Error('단계를 찾을 수 없습니다.');
      if (message.remove) state.steps = state.steps.filter(item => item.id !== message.id);
      else {
        if (!['fixed', 'variable', 'manual'].includes(message.mode)) throw new Error('지원하지 않는 단계 모드입니다.');
        step.mode = message.mode;
        step.variable = String(message.variable || '').slice(0, 80);
        step.note = String(message.note || '').slice(0, 500);
        if (step.mode === 'variable') step.value = ''; // Drop the observed value from storage as well.
      }
      await write(state); return state;
    }
    case 'recording:clear': {
      const state = await read();
      if (state?.status === 'recording') throw new Error('기록을 끝낸 뒤 지우세요.');
      await chrome.storage.session.remove(KEY); return null;
    }
    default: throw new Error('지원하지 않는 요청입니다.');
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Preserve the user gesture for sidePanel.open; do not enqueue that request.
  const operation = message.type === 'studio:open' ? handle(message, sender) : serial(() => handle(message, sender));
  operation.then(value => respond({ ok: true, value }), error => respond({ ok: false, error: error.message }));
  return true;
});
const configure = async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await registerCapture();
};
chrome.runtime.onInstalled.addListener(() => configure().catch(console.error));
chrome.runtime.onStartup.addListener(() => configure().catch(console.error));
chrome.permissions.onAdded.addListener(() => registerCapture().catch(console.error));
chrome.permissions.onRemoved.addListener(() => {
  registerCapture().catch(console.error);
  serial(async () => {
    const state = await read();
    if (state?.status !== 'recording') return;
    state.status = 'stopped'; state.stoppedAt = new Date().toISOString();
    state.note = '사이트 권한이 변경되어 기록을 끝냈습니다.';
    await write(state);
    await chrome.tabs.sendMessage(state.tabId, { type: 'capture:state', recordingId: null }).catch(() => {});
  }).catch(console.error);
});
chrome.tabs.onRemoved.addListener(tabId => serial(async () => {
  const state = await read();
  if (state?.tabId === tabId && state.status === 'recording') {
    state.status = 'stopped'; state.stoppedAt = new Date().toISOString(); state.note = '기록하던 탭이 닫혔습니다.';
    await write(state);
  }
}));
