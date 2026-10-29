import { MAX_STEPS, DEFAULT_STOP_BEFORE, normalizeEvent } from './recorder/model.js';
import { LIBRARY_KEY, libraryState, matchesSite, changeLibrary } from './core/script-library.js';
import { inspectFrames, sitePattern } from './recorder/frames.js';
import { createScriptRuntime } from './scripts/runtime.js';
import { SITES_KEY, siteOrigin, siteSettings, siteEnabled } from './core/site-settings.js';
import { optionalResetPermissions } from './core/reset.js';
import { createBuildUpdater } from './core/build-updates.js';
import { STORE_BUILD } from './core/distribution.js';
import { UPDATE_PREFERENCES_KEY, AVAILABLE_UPDATE_KEY, availableVersion } from './core/update-notices.js';

const KEY = 'macroStudioRecording';
const CAPTURE_FILES = ['core/namespace.js', 'ui/launcher.js', 'core/studio-entry.js', 'recorder/capture.js'];
const CAPTURE_NOTE = '일부 내부 화면에 기록기를 연결하지 못했습니다. 해당 화면이 열린 뒤 기록기 다시 연결을 누르세요.';
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
const readSites = async () => siteSettings((await chrome.storage.local.get(SITES_KEY))[SITES_KEY]);
async function requireSiteOn(origin) {
  if (!siteEnabled(await readSites(), origin)) throw new Error('도구모음의 Macro Studio에서 이 사이트에 적용을 ON으로 켜주세요.');
}
const localScripts = createScriptRuntime(chrome, { changed: refreshOpenTabs });
const sessionReady = localScripts.restoreSession();
let applyingUpdate = false;
const buildUpdates = createBuildUpdater(chrome, {
  loadedBuild: '__MACRO_STUDIO_BUILD_ID__',
  fetchBuild: async () => {
    const response = await fetch(chrome.runtime.getURL('core/build-info.json'), { cache: 'no-store' });
    if (!response.ok) throw new Error('빌드 중입니다.');
    return response.json();
  },
  apply: applyBuildUpdate
});
async function prepareLaunchers(lock) {
  const { origins = [] } = await chrome.permissions.getAll();
  const tabs = (await chrome.tabs.query({})).filter(tab => origins.some(pattern => matchesSite(pattern, tab.url)));
  const results = await Promise.all(tabs.map(async tab => {
    try {
      return await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, world: 'ISOLATED',
        func: shouldLock => {
          const host = document.getElementById('macro-studio-launcher');
          if (!host) return { busy: false };
          const busy = host.getAttribute('aria-busy') === 'true';
          if (shouldLock && !busy) host.dispatchEvent(new CustomEvent('macro-studio:library-state', {
            detail: JSON.stringify({ ready: false, archived: [], deleted: [] })
          }));
          return { busy };
        }, args: [lock] });
    } catch { return []; } // Closed/restricted documents have no reachable launcher.
  }));
  return !results.flat().some(item => item?.result?.busy);
}
async function applyBuildUpdate(confirm = async () => true) {
  if (applyingUpdate || (await read())?.status === 'recording') return false;
  return localScripts.whenIdle(async () => {
    applyingUpdate = true;
    let reload = false;
    try {
      if (!await prepareLaunchers(false) || !await prepareLaunchers(true)) return false;
      // Extension pages flush drafts before their context is replaced.
      const prepared = await chrome.runtime.sendMessage({ type: 'update:prepare' }).catch(() => null);
      if (prepared?.saved === false) return false;
      if (!await confirm()) return false;
      const pages = (await chrome.tabs.query({})).flatMap(tab => {
        if (!tab.url?.startsWith(chrome.runtime.getURL('ui/'))) return [];
        const path = new URL(tab.url).pathname;
        return ['/ui/studio.html', '/ui/scripts.html', '/ui/library.html'].includes(path) ? [{ id: tab.id, path }] : [];
      });
      await chrome.storage.local.set({ macroStudioResumeUpdatePages: pages });
      await localScripts.preserveSession();
      reload = true;
      // Reply to the check request before Chrome replaces this worker.
      setTimeout(() => chrome.runtime.reload(), 0);
      return true;
    } finally {
      if (!reload) {
        applyingUpdate = false;
        await refreshOpenTabs();
        await chrome.runtime.sendMessage({ type: 'update:cancel' }).catch(() => {});
      }
    }
  });
}
async function refreshOpenTabs() {
  const { origins = [] } = await chrome.permissions.getAll();
  const framesEnabled = await chrome.permissions.contains({ permissions: ['webNavigation'] });
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.filter(tab => tab.id && origins.some(pattern => matchesSite(pattern, tab.url))).map(async tab => {
    let frames = [{ frameId: 0, url: tab.url }];
    if (framesEnabled) frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id }) || frames;
    await Promise.allSettled(frames.filter(frame => origins.some(pattern => matchesSite(pattern, frame.url))).map(frame =>
      chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [frame.frameId] }, files: CAPTURE_FILES })));
    await chrome.tabs.sendMessage(tab.id, { type: 'local:changed' }).catch(() => {});
  }));
}
async function connectCapture(info, recordingId = null) {
  const frameIds = [...new Set(info.permitted.flatMap(group => group.frameIds))];
  if (!frameIds.includes(0)) throw new Error('이 사이트 접근을 먼저 허용하세요.');
  await registerCapture();
  const outcomes = await Promise.allSettled(frameIds.map(async frameId => {
    await chrome.scripting.executeScript({ target: { tabId: info.tabId, frameIds: [frameId] }, files: CAPTURE_FILES });
    if (recordingId) await chrome.tabs.sendMessage(info.tabId, { type: 'capture:state', recordingId }, { frameId });
  }));
  const topIndex = frameIds.indexOf(0);
  if (outcomes[topIndex].status === 'rejected') throw outcomes[topIndex].reason;
  return { connected: outcomes.filter(result => result.status === 'fulfilled').length,
    failed: outcomes.filter(result => result.status === 'rejected').length };
}
async function activate(message) {
  const info = await inspectFrames(chrome, message.tabId);
  if (message.origin && message.origin !== info.origin) throw new Error('페이지 주소가 바뀌었습니다. 현재 화면을 다시 확인하세요.');
  await requireSiteOn(info.origin);
  const state = await read();
  const continuing = state?.status === 'recording' && state.tabId === info.tabId;
  if (continuing) {
    for (const group of info.permitted) if (!state.origins.includes(group.pattern)) state.origins.push(group.pattern);
    await write(state);
  }
  const result = await connectCapture(info, continuing ? state.id : null);
  if (continuing) {
    if (result.failed) state.note = CAPTURE_NOTE; else delete state.note;
    await write(state);
  }
  return result;
}
let catalogPromise;
const catalog = () => catalogPromise ||= fetch(chrome.runtime.getURL('core/script-catalog.json')).then(response => {
  if (!response.ok) throw new Error('스크립트 목록을 읽지 못했습니다. 확장을 다시 빌드하고 새로고침하세요.');
  return response.json();
}).catch(error => { catalogPromise = null; throw error; });
async function scripts(message, sender) {
  if (sender.id !== chrome.runtime.id) throw new Error('확장 프로그램에서 실행하세요.');
  const all = await localScripts.catalog(await catalog());
  const ui = controlPage(sender);
  const available = ui ? all : sender.tab ? all.filter(script =>
    script.matches.some(pattern => matchesSite(pattern, sender.url))) : [];
  let state = libraryState((await chrome.storage.local.get(LIBRARY_KEY))[LIBRARY_KEY]);
  if (message.type !== 'scripts:state') {
    if (!available.some(script => script.id === message.id)) throw new Error('이 페이지의 스크립트가 아닙니다.');
    // Permanent removal is available only in the extension's library, never via a page message.
    if (message.type !== 'scripts:archive' && !ui) throw new Error('스크립트 보관함에서 실행하세요.');
    state = changeLibrary(state, message.type.slice('scripts:'.length), message.id);
    await chrome.storage.local.set({ [LIBRARY_KEY]: state });
    await localScripts.sync(await catalog());
  }
  const ids = new Set(available.map(script => script.id));
  const view = { ready: true, available: available.filter(script => !script.unavailable).map(script => script.id), archived: state.archived.filter(id => ids.has(id)), deleted: state.deleted.filter(id => ids.has(id)) };
  return ui ? { ...view, catalog: all.filter(script => !state.deleted.includes(script.id)) } :
    { ...view, siteEnabled: siteEnabled(await readSites(), siteOrigin(sender.url)) };
}

async function siteView(info) {
  return { tabId: info.tabId, origin: info.origin, pattern: info.pattern, allowed: info.topAllowed,
    enabled: info.topAllowed && siteEnabled(await readSites(), info.origin) };
}
async function setSite(message) {
  const info = await inspectFrames(chrome, message.tabId);
  if (message.origin !== info.origin) throw new Error('페이지 주소가 바뀌었습니다. 팝업을 다시 열어주세요.');
  if (typeof message.enabled !== 'boolean') throw new Error('사이트 적용 상태를 확인하세요.');
  if (message.enabled) await connectCapture(info);
  const settings = await readSites();
  settings[info.origin] = message.enabled;
  await chrome.storage.local.set({ [SITES_KEY]: settings });
  if (!message.enabled) {
    const recording = await read();
    if (recording?.status === 'recording' && recording.origin === info.origin) {
      recording.status = 'stopped'; recording.stoppedAt = new Date().toISOString();
      recording.note = '이 사이트에 적용을 OFF로 전환해 기록을 끝냈습니다.';
      await write(recording);
      await chrome.tabs.sendMessage(recording.tabId, { type: 'capture:state', recordingId: null }).catch(() => {});
    }
  }
  // Storage events also update the other tabs of this site.
  await chrome.tabs.sendMessage(info.tabId, { type: 'local:changed' }).catch(() => {});
  return siteView(info);
}

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
  const info = await inspectFrames(chrome, message.tabId);
  if (!info.topAllowed) throw new Error('이 사이트 접근을 먼저 허용하세요.');
  await requireSiteOn(info.origin);
  const origins = [...new Set(info.permitted.map(group => group.pattern))];
  const state = { id: crypto.randomUUID(), schemaVersion: 1, name: String(message.name || '나의 자동화').slice(0, 100),
    status: 'recording', tabId: info.tabId, origin: info.origin, origins, createdAt: new Date().toISOString(), steps: [],
    stopBefore: DEFAULT_STOP_BEFORE };
  await write(state);
  try {
    const result = await connectCapture(info, state.id);
    if (result.failed) {
      state.note = CAPTURE_NOTE;
      await write(state);
    }
  } catch (error) {
    state.status = 'error'; state.error = error.message; await write(state);
    throw new Error('기록기를 연결하지 못했습니다. 페이지를 새로고침하고 다시 시작하세요. ' + error.message);
  }
  return state;
}
async function handle(message, sender) {
  // Keep sidePanel.open in the original click gesture; other requests wait for
  // the recording/draft checkpoint to be restored after a reload.
  if (message.type !== 'studio:open') await sessionReady;
  if (applyingUpdate && ['recording:start', 'studio:activate', 'local:run', 'local:connect'].includes(message.type)) {
    throw new Error('업데이트를 적용하는 중입니다. 잠시 후 다시 실행하세요.');
  }
  if (['scripts:state', 'scripts:archive', 'scripts:restore', 'scripts:delete'].includes(message.type)) return scripts(message, sender);
  if (message.type === 'local:connect' && sender.id === chrome.runtime.id && sender.tab) {
    try { return await localScripts.connect(sender) || {}; }
    catch (error) { return { error: error.message }; }
  }
  if (message.type === 'local:run') {
    // The toggle belongs to the tab's top-level site, including runs in permitted child frames.
    const origin = sender.frameId > 0 && sender.tab ?
      (await inspectFrames(chrome, sender.tab.id)).origin : siteOrigin(sender.url);
    await requireSiteOn(origin);
    return localScripts.run(message, sender);
  }
  if (message.type === 'capture:status') {
    const state = await read();
    if (state?.status === 'recording' && sender.id === chrome.runtime.id && sender.tab?.id === state.tabId && !allowed(state, sender)) {
      try {
        const pattern = sitePattern(sender.url);
        if (await chrome.permissions.contains({ origins: [pattern] })) {
          state.origins.push(pattern); await write(state);
        }
      } catch { /* Restricted documents cannot join a recording. */ }
    }
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
  if (message.type === 'studio:open' && sender.id === chrome.runtime.id && sender.tab && sender.frameId === 0) {
    await chrome.sidePanel.open({ tabId: sender.tab.id });
    return { ok: true };
  }
  if (message.type === 'library:open' && sender.id === chrome.runtime.id && (controlPage(sender) || (sender.tab && sender.frameId === 0))) {
    await chrome.tabs.create({ url: chrome.runtime.getURL('ui/library.html') });
    return { ok: true };
  }
  if (!controlPage(sender)) throw new Error('확장 프로그램 화면에서 실행하세요.');
  switch (message.type) {
    case 'update:check': return STORE_BUILD ? { pending: false, managedByChrome: true } : buildUpdates.check();
    case 'update:reload': return { applying: await applyBuildUpdate() };
    case 'reset:state': {
      const [recording, status, sites, library] = await Promise.all([read(), localScripts.status(), readSites(),
        scripts({ type: 'scripts:state' }, sender)]);
      return { steps: recording?.steps?.length || 0, recording: recording?.status === 'recording', scripts: library.catalog.length,
        connected: status.connected, sites: Object.keys(sites).length, running: status.running };
    }
    case 'reset:confirm': {
      if (new URL(sender.url).pathname !== '/ui/reset.html' || message.confirmed !== true) throw new Error('초기화 화면에서 삭제 범위를 확인하세요.');
      return localScripts.reset(async () => {
        const state = await read();
        if (state?.status === 'recording') {
          state.status = 'stopped'; await write(state);
          await chrome.tabs.sendMessage(state.tabId, { type: 'capture:state', recordingId: null }).catch(() => {});
        }
        await chrome.runtime.sendMessage({ type: 'studio:reset' }).catch(() => {});
        await chrome.storage.session.remove([KEY, 'macroStudioStudioDraft']);
        await chrome.storage.local.remove([LIBRARY_KEY, SITES_KEY, UPDATE_PREFERENCES_KEY, AVAILABLE_UPDATE_KEY, 'macroStudioResumeScriptsTab', 'macroStudioResumeUpdatePages']);
        // Clearing imported data must not revive scripts still bundled in an older build.
        const deleted = (await catalog()).map(script => script.id);
        if (deleted.length) await chrome.storage.local.set({ [LIBRARY_KEY]: { archived: [], deleted } });
        const optional = optionalResetPermissions(chrome.runtime.getManifest(), await chrome.permissions.getAll());
        if ((optional.origins.length || optional.permissions.length) && !await chrome.permissions.remove(optional)) {
          throw new Error('기록과 개인 설정은 삭제했지만 일부 선택 권한을 회수하지 못했습니다. 다시 초기화하거나 Chrome 설정을 확인하세요.');
        }
        await registerCapture();
        await refreshOpenTabs();
        return { reset: true };
      });
    }
    case 'site:state': return siteView(await inspectFrames(chrome, message.tabId));
    case 'site:set': return setSite(message);
    case 'local:status': return localScripts.status();
    case 'local:sync': return localScripts.sync(await catalog());
    case 'local:open': return chrome.tabs.create({ url: chrome.runtime.getURL('ui/scripts.html') });
    case 'studio:state': return await read();
    case 'frames:scan': {
      const { permitted, ...info } = await inspectFrames(chrome, message.tabId);
      return info;
    }
    case 'studio:activate': return await activate(message);
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
        step.modeSource = 'user';
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
  const operation = ['studio:open', 'local:run'].includes(message.type) ? handle(message, sender) : serial(() => handle(message, sender));
  operation.then(value => respond({ ok: true, value }), error => respond({ ok: false, error: error.message }));
  return true;
});
const configure = async (installed = false) => {
  await sessionReady;
  if (installed && !STORE_BUILD) await buildUpdates.installed();
  if (installed) await chrome.storage.local.remove(AVAILABLE_UPDATE_KEY);
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  await registerCapture();
  await chrome.alarms.create('macro-studio-script-sync', { periodInMinutes: 0.5 });
  if (STORE_BUILD) await chrome.alarms.clear('macro-studio-build-check');
  else await chrome.alarms.create('macro-studio-build-check', { periodInMinutes: 0.5 });
  await localScripts.sync(await catalog());
  await refreshOpenTabs();
  const { macroStudioResumeUpdatePages: pages = [] } = await chrome.storage.local.get('macroStudioResumeUpdatePages');
  await chrome.storage.local.remove('macroStudioResumeUpdatePages');
  for (const page of pages) {
    if (!Number.isInteger(page.id) || !['/ui/studio.html', '/ui/scripts.html', '/ui/library.html'].includes(page.path)) continue;
    const tab = await chrome.tabs.get(page.id).catch(() => null);
    const url = chrome.runtime.getURL(page.path.slice(1));
    if (!tab) await chrome.tabs.create({ url });
    else if (tab.url?.split('?')[0] === url) await chrome.tabs.update(page.id, { url });
  }
  const { macroStudioResumeScriptsTab: tabId } = await chrome.storage.local.get('macroStudioResumeScriptsTab');
  if (Number.isInteger(tabId)) {
    await chrome.storage.local.remove('macroStudioResumeScriptsTab');
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    const url = chrome.runtime.getURL('ui/scripts.html') + '?updated=' + Date.now();
    if (!tab) await chrome.tabs.create({ url }); // Chrome may close extension tabs during reload.
    else if (tab.url?.startsWith(chrome.runtime.getURL('ui/scripts.html'))) await chrome.tabs.update(tabId, { url });
  }
};
chrome.runtime.onInstalled.addListener(() => configure(true).catch(console.error));
chrome.runtime.onStartup.addListener(() => configure().catch(console.error));
if (STORE_BUILD) chrome.runtime.onUpdateAvailable?.addListener(details => {
  const version = availableVersion(details);
  // Chrome owns installation. Do not force a reload while the user is recording or running a macro.
  if (version) chrome.storage.local.set({ [AVAILABLE_UPDATE_KEY]: { version } }).catch(console.error);
});
chrome.permissions.onAdded.addListener(() => serial(async () => { await registerCapture(); await localScripts.sync(await catalog()); await refreshOpenTabs(); }).catch(console.error));
chrome.permissions.onRemoved.addListener(() => {
  serial(async () => { await registerCapture(); await localScripts.sync(await catalog()); await refreshOpenTabs(); }).catch(console.error);
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
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'macro-studio-script-sync') serial(async () => localScripts.sync(await catalog())).catch(console.error);
  if (alarm.name === 'macro-studio-build-check' && !STORE_BUILD) serial(() => buildUpdates.check()).catch(console.error);
});
