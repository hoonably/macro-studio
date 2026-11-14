import { inspectFrames } from './frames.js';

const POPUP_KEY = 'macroStudioFramePermissionWindow';

/** Call through the worker's recording queue so pausing never overwrites steps. */
export function createFramePermissionMonitor(chrome, { read, write, connect }) {
  async function close() {
    const state = await read();
    if (state?.tabId !== undefined) {
      const tab = await chrome.tabs.get(state.tabId).catch(() => null);
      if (tab) await chrome.runtime.sendMessage({ type:'panel:permissions-clear',windowId:tab.windowId }).catch(() => {});
      await chrome.tabs.sendMessage(state.tabId,{ type:'capture:permission-clear' },{ frameId:0 }).catch(() => {});
    }
    // Close only a legacy permission window created by a previous build.
    const popup = (await chrome.storage.session.get(POPUP_KEY))[POPUP_KEY];
    if (!popup) return;
    await chrome.storage.session.remove(POPUP_KEY);
    await chrome.windows.remove(popup.windowId).catch(() => {});
  }
  async function show() {
    const state = await read();
    if (state?.status !== 'recording' || !state.pendingFrameOrigins?.length) return false;
    const tab = await chrome.tabs.get(state.tabId);
    const panel = await chrome.runtime.sendMessage({ type:'panel:permissions',windowId:tab.windowId,recordingId:state.id }).catch(() => null);
    await chrome.tabs.sendMessage(state.tabId, panel?.shown ? {type:'capture:permission-clear'} :
      {type:'capture:permission-needed',recordingId:state.id},{frameId:0}).catch(() => {});
    return true;
  }
  async function review(tabId, { openPrompt = true } = {}) {
    const state = await read();
    if (state?.status !== 'recording' || state.tabId !== tabId) return;
    const info = await inspectFrames(chrome, tabId);
    if (info.origin !== state.origin || !info.detectionEnabled) return;
    const missing = info.frames.filter(frame => !frame.allowed).map(frame => frame.pattern);
    const previous = state.pendingFrameOrigins || [];
    if (missing.length) {
      const signature = JSON.stringify(missing);
      const shouldOpen = openPrompt && state.framePermissionPrompt !== signature;
      state.pendingFrameOrigins = missing;
      if (!previous.length) state.permissionInterruptions = (state.permissionInterruptions || 0) + 1;
      state.note = '새 내부 사이트의 접근 허용을 기다리며 기록을 잠시 멈췄습니다. 허용한 뒤 해당 화면의 작업을 이어가세요.';
      if (shouldOpen) state.framePermissionPrompt = signature;
      await write(state);
      if (!previous.length) await chrome.tabs.sendMessage(tabId, { type: 'capture:state', recordingId: null }).catch(() => {});
      if (shouldOpen) await show().catch(() => {});
    } else if (previous.length) {
      state.pendingFrameOrigins = [];
      delete state.framePermissionPrompt;
      for (const group of info.permitted) if (!state.origins.includes(group.pattern)) state.origins.push(group.pattern);
      state.note = '내부 화면 접근을 확인해 기록을 이어갑니다. 허용 전에 진행한 작업이 있다면 해당 부분부터 다시 기록하세요.';
      await write(state);
      try {
        const result = await connect(info, state.id);
        if (result.failed) {
          state.status = 'error';
          state.error = '일부 내부 화면에 기록기를 연결하지 못해 기록을 재개하지 않았습니다. 기존 기록은 보존됩니다.';
          await write(state);
        }
      } catch (error) {
        state.status = 'error'; state.error = '기록기를 다시 연결하지 못했습니다. ' + error.message;
        await write(state);
      }
      if (state.status === 'recording') await close();
      else await chrome.tabs.sendMessage(tabId, { type: 'capture:state', recordingId: null }).catch(() => {});
    }
  }
  async function status(recordingId) {
    const current = await read();
    if (current?.id !== recordingId || current.status !== 'recording') return { active: false, origins: [],
      ...(current?.id === recordingId && current.error ? { error:current.error } : {}) };
    await review(current.tabId, { openPrompt: false });
    const state = await read();
    return { active: state.status === 'recording', id: state.id, tabId: state.tabId,
      origins: (state.pendingFrameOrigins || []).map(pattern => pattern.slice(0, -2)),
      ...(state.error ? { error:state.error } : {}) };
  }
  return { review, show, status, close };
}
