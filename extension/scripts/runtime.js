import { LOCAL_KEY, originPattern, readScripts } from './directory.js';
import { readLocal, writeLocal, resetLocal } from './store.js';
import { compileSource, invokeDefinition } from './source.js';
import { LIBRARY_KEY, libraryState, matchesSite } from '../core/script-library.js';

const PREFIX = 'macro-studio-local-';
// Bump when the generated user-code wrapper changes so saved snapshots are rebuilt too.
const SOURCE_VERSION = 1;
const registrationValue = entry => JSON.stringify({ id: entry.id, matches: [...entry.matches].sort(), js: entry.js,
  allFrames: !!entry.allFrames, runAt: entry.runAt || 'document_idle', world: entry.world || 'USER_SCRIPT',
  worldId: entry.world === 'MAIN' ? null : entry.worldId || '' });
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
export function createScriptRuntime(chrome, { read = readLocal, write = writeLocal, clear = resetLocal, resource, changed = async () => {} } = {}) {
  const resources = new Map(), jobs = new Set(), connections = new Set();
  let syncing, resetting = false, epoch = 0;
  const text = path => {
    if (!resources.has(path)) resources.set(path, (resource ? resource(path) : fetch(chrome.runtime.getURL(path)).then(response => {
      if (!response.ok) throw new Error('공통 실행 코드를 읽지 못했습니다.');
      return response.text();
    })).catch(error => { resources.delete(path); throw error; }));
    return resources.get(path);
  };
  const snapshot = () => read('snapshot');
  async function available() { try { if (!chrome.userScripts?.execute) return false; await chrome.userScripts.getScripts(); return true; } catch { return false; } }
  async function catalog(base) {
    const current = await snapshot();
    const enabled = current ? await available() : false;
    return current ? [...base.filter(script => !script.bundled), ...current.scripts.map(script => ({ id: script.id, name: script.name,
      matches: [...new Set(script.entries.flatMap(entry => entry.matches))], local: true, unavailable: !enabled }))] : base;
  }
  async function missingOrigins(scripts) {
    const origins = [...new Set(scripts.flatMap(script => script.entries.flatMap(entry => entry.matches.map(originPattern))))];
    const grants = await Promise.all(origins.map(origin => chrome.permissions.contains({ origins: [origin] })));
    return origins.filter((_, index) => !grants[index]);
  }
  async function status() {
    const [folder, current, state, enabled] = await Promise.all([read('folder'), snapshot(), chrome.storage.local.get(LOCAL_KEY), available()]);
    let readable = false;
    try { readable = !!folder && await folder.queryPermission({ mode: 'read' }) === 'granted'; } catch {}
    return { ...(state[LOCAL_KEY] || {}), connected: !!folder, folderName: folder?.name || current?.folderName || '', readable, enabled,
      count: current?.scripts.length || 0, scripts: (current?.scripts || []).map(script => ({ id: script.id, name: script.name, matches: [...new Set(script.entries.flatMap(entry => entry.matches))] })),
      revision: current?.revision || '', missingOrigins: await missingOrigins(current?.scripts || []), running: jobs.size > 0 };
  }
  async function publish(values) {
    const previous = (await chrome.storage.local.get(LOCAL_KEY))[LOCAL_KEY] || {};
    const next = { ...previous, ...values };
    if (JSON.stringify(previous) !== JSON.stringify(next)) await chrome.storage.local.set({ [LOCAL_KEY]: next });
  }
  async function definitions(current) {
    const deleted = libraryState((await chrome.storage.local.get(LIBRARY_KEY))[LIBRARY_KEY]).deleted;
    const result = [];
    for (const entry of current?.entries || []) {
      if (deleted.includes(entry.scriptId)) continue;
      const matches = [];
      for (const pattern of entry.matches) if (await chrome.permissions.contains({ origins: [originPattern(pattern)] })) matches.push(pattern);
      if (matches.length) result.push({ id: entry.registrationId, matches, js: [{ code: entry.code }], allFrames: entry.allFrames,
        runAt: 'document_idle', world: entry.world, ...(entry.world === 'USER_SCRIPT' ? { worldId: 'macro-studio-local' } : {}) });
    }
    return result;
  }
  async function reconcile(current) {
    if (!await available()) throw new Error('Chrome에서 Macro Studio의 사용자 스크립트 허용을 켜주세요.');
    const previous = (await chrome.userScripts.getScripts()).filter(entry => entry.id.startsWith(PREFIX));
    const next = await definitions(current), oldIds = new Set(previous.map(entry => entry.id)), nextIds = new Set(next.map(entry => entry.id));
    const added = next.filter(entry => !oldIds.has(entry.id)), updated = next.filter(entry => oldIds.has(entry.id) &&
      registrationValue(entry) !== registrationValue(previous.find(old => old.id === entry.id)));
    const removed = previous.filter(entry => !nextIds.has(entry.id));
    try {
      if (added.length) await chrome.userScripts.register(added);
      if (updated.length) await chrome.userScripts.update(updated);
      if (removed.length) await chrome.userScripts.unregister({ ids: removed.map(entry => entry.id) });
    } catch (error) {
      // Restore registrations if any later step failed. Never replace the saved working snapshot on failure.
      const now = (await chrome.userScripts.getScripts()).filter(entry => entry.id.startsWith(PREFIX));
      const nowIds = new Set(now.map(entry => entry.id));
      const extra = now.filter(entry => !oldIds.has(entry.id));
      if (extra.length) await chrome.userScripts.unregister({ ids: extra.map(entry => entry.id) });
      const restore = previous.filter(entry => nowIds.has(entry.id)), missing = previous.filter(entry => !nowIds.has(entry.id));
      if (restore.length) await chrome.userScripts.update(restore);
      if (missing.length) await chrome.userScripts.register(missing);
      throw error;
    }
  }
  async function syncImpl(base = []) {
    const [folder, previous] = await Promise.all([read('folder'), snapshot()]);
    if (jobs.size) { await publish({ message: '실행이 끝나면 변경사항을 반영합니다.', error: '' }); return status(); }
    try {
      if (!folder) { if (previous && await available()) await reconcile(previous); if (previous) await publish({ error: '', errors: [], message: '자동 동기화가 꺼져 있습니다.' }); return status(); }
      if (await folder.queryPermission({ mode: 'read' }) !== 'granted') {
        if (previous && await available()) await reconcile(previous);
        await publish({ message: '폴더 읽기 권한을 다시 허용하면 자동 동기화가 이어집니다.', error: '' }); return status();
      }
      if (!await available()) { await publish({ message: '사용자 스크립트 허용을 켜면 동기화가 이어집니다.', error: '' }); return status(); }
      const { scripts, errors } = await readScripts(folder, previous?.scripts || []);
      if (scripts.some(script => base.some(item => !item.bundled && item.id === script.id))) throw new Error('공통 스크립트와 같은 id는 사용할 수 없습니다.');
      const revision = await digest(JSON.stringify({ sourceVersion: SOURCE_VERSION, scripts }));
      let next = previous;
      if (revision !== previous?.revision) {
        const entries = [];
        for (const script of scripts) {
          const version = await digest(JSON.stringify({ sourceVersion: SOURCE_VERSION, script }));
          for (const [index, entry] of script.entries.entries()) {
            const world = entry.world === 'MAIN' ? 'MAIN' : 'USER_SCRIPT', key = script.id + '/' + index;
            const sources = [...await Promise.all(entry.adapters.map(name => text('adapters/' + name + '.js'))), ...entry.files.map(path => script.files[path])];
            entries.push({ ...entry, world, scriptId: script.id, key, revision: version, registrationId: PREFIX + script.id + '-' + index,
              code: compileSource({ id: script.id, key, revision: version, world }, sources) });
          }
        }
        next = { scripts, entries, revision, folderName: folder.name, syncedAt: new Date().toISOString() };
      }
      await reconcile(next);
      if (next !== previous) {
        try { await write({ snapshot: next }); }
        catch (error) { await reconcile(previous); throw error; }
      }
      await publish({ revision, syncedAt: next.syncedAt, errors, error: '', message: errors.length ? '저장 중이거나 잘못된 파일은 마지막 정상 버전을 유지합니다.' : '파일을 저장하면 스크립트 목록에 자동으로 반영됩니다.' });
      if (next !== previous) await changed();
    } catch (error) { await publish({ error: String(error.message).slice(0, 500), message: '마지막 정상 버전을 유지합니다.' }); }
    return status();
  }
  function sync(base) {
    if (resetting) return Promise.reject(new Error('개인 설정을 초기화하는 중입니다.'));
    if (syncing) return syncing;
    syncing = syncImpl(base).finally(() => { syncing = null; });
    return syncing;
  }
  async function connectImpl(sender) {
    const current = await snapshot();
    if (!current || !sender.tab || !await available()) return;
    const frameId = sender.frameId || 0, target = { tabId: sender.tab.id, frameIds: [frameId] };
    const list = [], errors = [], attempted = new Set();
    const state = libraryState((await chrome.storage.local.get(LIBRARY_KEY))[LIBRARY_KEY]);
    for (const entry of current.entries.filter(entry => !state.deleted.includes(entry.scriptId) &&
      (frameId === 0 || entry.allFrames) && entry.matches.some(pattern => matchesSite(pattern, sender.url)))) {
      attempted.add(entry.scriptId);
      try {
      if (!await chrome.permissions.contains({ origins: [originPattern(entry.matches.find(pattern => matchesSite(pattern, sender.url)))] })) continue;
      const results = await chrome.userScripts.execute({ target, world: entry.world, ...(entry.world === 'USER_SCRIPT' ? { worldId: 'macro-studio-local' } : {}), js: [{ code: entry.code }] });
      const failure = results.find(result => result.error); if (failure) throw new Error(failure.error);
      list.push(...results.flatMap(result => result.result || []));
      } catch (error) { errors.push({ id: entry.scriptId, message: String(error.message).slice(0, 250) }); }
    }
    const previous = (await chrome.storage.local.get(LOCAL_KEY))[LOCAL_KEY] || {};
    await publish({ runtimeErrors: [...(previous.runtimeErrors || []).filter(item => !attempted.has(item.id)), ...errors] });
    if (!list.length) return { error: errors.map(item => item.id + ': ' + item.message).join('\n') };
    const world = chrome.runtime.getManifest().content_scripts?.some(entry => entry.world === 'MAIN' && entry.matches.some(pattern => matchesSite(pattern, sender.url))) ? 'MAIN' : 'ISOLATED';
    await chrome.scripting.executeScript({ target, world, files: ['core/namespace.js', 'ui/launcher.js', 'scripts/proxy.js'] });
    await chrome.scripting.executeScript({ target, world, func: data => window.MacroStudio.scriptProxy.mount(data), args: [list] });
    return { error: errors.map(item => item.id + ': ' + item.message).join('\n') };
  }
  function connect(sender) {
    if (resetting) return Promise.reject(new Error('개인 설정을 초기화하는 중입니다.'));
    const connection = connectImpl(sender).finally(() => connections.delete(connection));
    connections.add(connection);
    return connection;
  }
  async function run(message, sender) {
    const startedEpoch = epoch;
    if (resetting) throw new Error('개인 설정을 초기화하는 중입니다.');
    if (!sender.tab || !Number.isInteger(sender.frameId) || sender.id !== chrome.runtime.id) throw new Error('페이지에서 직접 실행하세요.');
    const current = await snapshot(), state = libraryState((await chrome.storage.local.get(LIBRARY_KEY))[LIBRARY_KEY]);
    const entry = current?.entries.find(entry => entry.key === message.key && entry.scriptId === message.id && entry.revision === message.revision &&
      (sender.frameId === 0 || entry.allFrames) && entry.matches.some(pattern => matchesSite(pattern, sender.url)));
    if (!entry || state.archived.includes(message.id) || state.deleted.includes(message.id)) throw new Error('사용할 수 없거나 변경된 스크립트입니다. 목록에서 다시 선택하세요.');
    const values = message.values;
    if (!values || typeof values !== 'object' || Array.isArray(values) || Object.keys(values).length > 30 ||
      Object.values(values).some(value => typeof value !== 'string' || value.length > 2000)) throw new Error('입력값을 확인하세요.');
    if (typeof message.requestId !== 'string' || message.requestId.length > 100) throw new Error('잘못된 실행 요청입니다.');
    const job = sender.tab.id + '/' + sender.frameId;
    if (resetting || startedEpoch !== epoch) throw new Error('개인 설정이 초기화되었습니다. 페이지를 새로고침하세요.');
    if (jobs.has(job)) throw new Error('이 페이지에서 이미 실행 중입니다.');
    jobs.add(job);
    try {
      if (!await available()) throw new Error('Chrome에서 사용자 스크립트 허용을 켜주세요.');
      const args = { key: entry.key, revision: entry.revision, id: entry.scriptId, values, requestId: message.requestId };
      const result = await chrome.userScripts.execute({ target: { tabId: sender.tab.id, frameIds: [sender.frameId] }, world: entry.world,
        ...(entry.world === 'USER_SCRIPT' ? { worldId: 'macro-studio-local' } : {}), js: [{ code: '(' + invokeDefinition.toString() + ')(' + JSON.stringify(args) + ')' }] });
      if (result[0]?.error) throw new Error(result[0].error);
      return result[0]?.result;
    } finally { jobs.delete(job); }
  }
  async function reset(cleanup) {
    if (resetting) throw new Error('이미 초기화 중입니다.');
    if (jobs.size) throw new Error('실행 중인 매크로가 끝난 뒤 초기화하세요.');
    resetting = true; epoch++;
    try {
      // Finish previous reads/writes first; no new sync, connection or job can enter.
      await Promise.allSettled([syncing, ...connections].filter(Boolean));
      if (await available()) {
        const ids = (await chrome.userScripts.getScripts()).filter(entry => entry.id.startsWith(PREFIX)).map(entry => entry.id);
        if (ids.length) await chrome.userScripts.unregister({ ids });
      } else if ((await snapshot())?.entries?.length) throw new Error('등록한 코드까지 삭제하려면 Chrome에서 사용자 스크립트 허용을 켠 뒤 다시 초기화하세요.');
      await clear();
      resources.clear();
      await chrome.storage.local.remove(LOCAL_KEY);
      return await cleanup();
    } finally { resetting = false; }
  }
  async function whenIdle(action) {
    if (resetting || jobs.size) return false;
    resetting = true; epoch++;
    try {
      await Promise.allSettled([syncing, ...connections].filter(Boolean));
      return await action();
    } finally { resetting = false; }
  }
  async function preserveSession() {
    const values = await chrome.storage.session.get(['macroStudioRecording', 'macroStudioStudioDraft']);
    await write({ updateSession: values });
  }
  async function restoreSession() {
    const values = await read('updateSession');
    if (!values || typeof values !== 'object') return;
    // Chrome clears storage.session on extension reload. Keep this temporary
    // checkpoint in our private IndexedDB, then remove it immediately on restore.
    if (Object.keys(values).length) await chrome.storage.session.set(values);
    await write({ updateSession: undefined });
  }
  return { catalog, snapshot, status, sync, connect, run, reconcile, reset, whenIdle, preserveSession, restoreSession };
}
