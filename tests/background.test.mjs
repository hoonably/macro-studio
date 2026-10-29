import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { MAX_STEPS, DEFAULT_STOP_BEFORE, normalizeEvent } from '../extension/recorder/model.js';
import { code } from './helpers.mjs';
import { LIBRARY_KEY, libraryState, matchesSite, changeLibrary } from '../extension/core/script-library.js';
import { inspectFrames, sitePattern } from '../extension/recorder/frames.js';
import { createScriptRuntime } from '../extension/scripts/runtime.js';
import { optionalResetPermissions } from '../extension/core/reset.js';
import { SITES_KEY, siteOrigin, siteSettings, siteEnabled } from '../extension/core/site-settings.js';
import { createBuildUpdater, LOADED_BUILD_KEY } from '../extension/core/build-updates.js';
import { UPDATE_PREFERENCES_KEY, AVAILABLE_UPDATE_KEY, availableVersion } from '../extension/core/update-notices.js';
// Most recorder tests model a site the user has already enabled. First-run/reset tests pass local: {}.
async function worker({ local = { [SITES_KEY]: { 'https://example.test': true } }, origins = ['https://example.test/*'], permissions = [],
  stored = {}, storeBuild = false,
  frames = [{ frameId: 0, url: 'https://example.test/form' }], catalog = [
  { id: 'weekly-task', name: '주간 작업', matches: ['https://example.test/*'] },
  { id: 'other-task', name: '다른 작업', matches: ['https://other.test/*'] }
] } = {}) {
  const state = {}, calls = [], lifecycle = {}, memory = stored;
  const diskBuild = { id: '0'.repeat(64) };
  let listener;
  const removed = [];
  const event = () => ({ addListener() {} });
  const chrome = {
    runtime: { id: 'studio', getManifest: () => ({ host_permissions: ['https://example.test/*'], optional_permissions: ['webNavigation'] }), getURL: file => 'chrome-extension://studio/' + file,
      sendMessage: async value => { calls.push(['extension-message', value]); return { saved: true }; }, reload: () => calls.push(['reload']),
      onMessage: { addListener: value => { listener = value; } }, onInstalled: { addListener: value => { lifecycle.installed = value; } }, onStartup: event(), onUpdateAvailable: { addListener: value => { lifecycle.updateAvailable = value; } } },
    storage: { session: { get: async keys => Object.fromEntries([].concat(keys).filter(key => state[key] !== undefined).map(key => [key, structuredClone(state[key])])),
      set: async value => Object.assign(state, structuredClone(value)), remove: async keys => { for (const key of [].concat(keys)) delete state[key]; } },
      local: { get: async key => ({ [key]: structuredClone(local[key]) }), set: async value => Object.assign(local, structuredClone(value)), remove: async keys => { for (const key of [].concat(keys)) delete local[key]; } } },
    permissions: { remove: async value => { calls.push(['remove-permissions', value]); return true; }, getAll: async () => ({ origins, permissions }), contains: async query =>
      (query.origins || []).every(item => origins.some(pattern => matchesSite(pattern, item))) &&
      (query.permissions || []).every(item => permissions.includes(item)), onAdded: event(), onRemoved: { addListener: value => removed.push(value) } },
    webNavigation: { getAllFrames: async () => structuredClone(frames) },
    scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async value => calls.push(['register', value]),
      executeScript: async value => calls.push(['inject', value]) },
    tabs: { get: async id => ({ id, url: 'https://example.test/form' }), query: async () => [{ id: 42, url: 'https://example.test/form' }], sendMessage: async (...args) => calls.push(['send', args]),
      create: async options => calls.push(['create', options]), update: async (...args) => calls.push(['update-tab', ...args]), onRemoved: event() },
    alarms: { create: async (name) => calls.push(['alarm', name]), clear: async name => calls.push(['clear-alarm', name]), onAlarm: { addListener: value => { lifecycle.alarm = value; } } },
    sidePanel: { open: async value => calls.push(['open', value]), setPanelBehavior: async value => calls.push(['panel-behavior', value]) }
  };
  const source = (await code('extension/background.js')).replace(/^import[^\n]+\n/gm, '');
  vm.runInNewContext(source, { STORE_BUILD: storeBuild, chrome, MAX_STEPS, DEFAULT_STOP_BEFORE, normalizeEvent, LIBRARY_KEY, libraryState, matchesSite, changeLibrary, inspectFrames, sitePattern,
    SITES_KEY, siteOrigin, siteSettings, siteEnabled, optionalResetPermissions, createBuildUpdater, UPDATE_PREFERENCES_KEY, AVAILABLE_UPDATE_KEY, availableVersion,
    createScriptRuntime: (browser, options) => createScriptRuntime(browser, { ...options, read: async key => memory[key], write: async values => Object.assign(memory, values), clear: async () => { for (const key of Object.keys(memory)) delete memory[key]; } }),
    fetch: async url => ({ ok: true, json: async () => structuredClone(url.endsWith('/core/build-info.json') ? diskBuild : catalog) }),
    setTimeout: callback => { callback(); return 0; }, crypto: webcrypto, URL, console, Date });
  const ui = { id: 'studio', url: 'chrome-extension://studio/ui/studio.html' };
  const content = { id: 'studio', url: 'https://example.test/form?token=private', frameId: 0, tab: { id: 42 } };
  const send = (message, sender = ui) => new Promise(resolve => listener(message, sender, resolve));
  return { state, local, memory, chrome, calls, send, ui, content, removed, origins, permissions, frames, lifecycle, diskBuild };
}
test('store distribution uses Chrome updates while keeping folder sync enabled', async () => {
  const env = await worker({ storeBuild: true });
  await env.lifecycle.installed();
  assert.ok(env.calls.some(call => call[0] === 'alarm' && call[1] === 'macro-studio-script-sync'));
  assert.ok(env.calls.some(call => call[0] === 'clear-alarm' && call[1] === 'macro-studio-build-check'));
  assert.ok(!env.calls.some(call => call[0] === 'alarm' && call[1] === 'macro-studio-build-check'));
  env.diskBuild.id = 'f'.repeat(64);
  assert.equal((await env.send({ type: 'update:check' })).value.managedByChrome, true);
  await env.lifecycle.alarm({ name: 'macro-studio-build-check' });
  assert.ok(!env.calls.some(call => call[0] === 'reload'));
});
test('store update notifications retain only a version and never force an active extension to reload', async () => {
  const env = await worker({ storeBuild: true });
  env.state.macroStudioRecording = { status: 'recording', steps: [{ type: 'click' }] };
  env.lifecycle.updateAvailable({ version: '1.4.0', unexpected: 'not-stored' });
  assert.deepEqual(env.local[AVAILABLE_UPDATE_KEY], { version: '1.4.0' });
  assert.equal(env.calls.some(call => call[0] === 'reload'), false);
  env.lifecycle.updateAvailable({ version: '<invalid>' });
  assert.deepEqual(env.local[AVAILABLE_UPDATE_KEY], { version: '1.4.0' });
  assert.equal((await env.send({ type: 'update:reload' }, env.content)).ok, false);
  await env.lifecycle.installed();
  assert.equal(env.local[AVAILABLE_UPDATE_KEY], undefined);
});
test('applying an extension update resumes its setup page even when Chrome closes extension tabs', async () => {
  for (const kind of ['closed', 'setup', 'other']) {
    const env = await worker({ local: { macroStudioResumeScriptsTab: 42 } });
    env.chrome.tabs.get = async () => {
      if (kind === 'closed') throw new Error('Tab closed during extension reload');
      return { id: 42, url: kind === 'setup' ? 'chrome-extension://studio/ui/scripts.html' : 'https://example.test/form' };
    };
    await env.lifecycle.installed();
    assert.equal(env.calls.find(call => call[0] === 'panel-behavior')[1].openPanelOnActionClick, false);
    assert.equal(env.local.macroStudioResumeScriptsTab, undefined);
    const resumed = env.calls.find(call => call[0] === (kind === 'closed' ? 'create' : 'update-tab'));
    if (kind === 'other') assert.equal(resumed, undefined, 'An unrelated tab must not be navigated');
    else assert.match(resumed.at(-1).url, /^chrome-extension:\/\/studio\/ui\/scripts\.html\?updated=\d+$/);
  }
});
test('frame discovery reads real nested URLs, deduplicates origins, and never grants access or leaks private URLs', async () => {
  const env = await worker({ permissions: ['webNavigation'], origins: ['https://example.test/*', 'https://known.test/*'], frames: [
    { frameId: 0, url: 'https://example.test/form' }, { frameId: 1, url: 'https://example.test/wrapper' },
    { frameId: 2, url: 'https://new.test/private?token=SECRET' }, { frameId: 3, url: 'https://new.test/another' },
    { frameId: 4, url: 'https://known.test/allowed' }, { frameId: 5, url: 'about:blank' },
    { frameId: 6, url: 'https://failed.test/', errorOccurred: true }
  ] });
  assert.equal((await env.send({ type: 'frames:scan', tabId: 42 }, env.content)).ok, false);
  const response = await env.send({ type: 'frames:scan', tabId: 42 });
  assert.ok(response.ok); const info = response.value;
  assert.equal(info.detectionEnabled, true); assert.equal(info.frames.length, 2);
  assert.equal(info.frames.find(frame => frame.origin === 'https://new.test').frameIds.length, 2);
  assert.equal(info.frames.find(frame => frame.origin === 'https://known.test').allowed, true);
  assert.equal(info.frames.find(frame => frame.origin === 'https://new.test').allowed, false);
  assert.ok(!JSON.stringify(info).includes('SECRET')); assert.ok(!JSON.stringify(info).includes('/private'));
  assert.equal(env.origins.length, 2);
  assert.equal((await env.send({ type: 'frames:scan', tabId: '42' })).ok, false);
});
test('new sites with a hidden tab URL use the approved top-frame lookup and remain gated by host permission', async () => {
  for (const origin of ['https://when2jam.pages.dev', 'https://www.naver.com', 'http://localhost:3000']) {
    const env = await worker({ permissions: ['webNavigation'], frames: [
      { frameId: 0, url: origin + '/page?token=PRIVATE' }, { frameId: 3, url: 'https://child.test/frame' }
    ] });
    env.chrome.tabs.get = async id => ({ id });
    const scan = await env.send({ type: 'frames:scan', tabId: 42 });
    assert.equal(scan.ok, true, scan.error);
    assert.equal(scan.value.origin, origin); assert.equal(scan.value.pattern, origin + '/*');
    assert.equal(scan.value.topAllowed, false);
    assert.equal(JSON.stringify(scan).includes('PRIVATE'), false);
    assert.equal((await env.send({ type: 'recording:start', tabId: 42 })).ok, false);
    assert.equal(env.calls.some(call => call[0] === 'inject'), false);
    env.origins.push(origin + '/*');
    assert.equal((await env.send({ type: 'site:set', tabId: 42, origin, enabled: true })).ok, true);
    assert.equal((await env.send({ type: 'studio:activate', tabId: 42, origin: 'https://old.test' })).ok, false);
    assert.equal((await env.send({ type: 'studio:activate', tabId: 42, origin })).ok, true);
    const started = await env.send({ type: 'recording:start', tabId: 42 });
    assert.equal(started.ok, true, started.error);
    await env.send({ type: 'capture:event', recordingId: started.value.id, event: { action: 'click', target: { label: '메뉴' } } },
      { ...env.content, url: origin + '/page' });
    assert.equal(env.state.macroStudioRecording.steps.length, 1);
  }
});
test('missing and malformed tab addresses produce guidance without borrowing a child frame or pending URL', async () => {
  const env = await worker();
  env.chrome.tabs.get = async id => ({ id, pendingUrl: 'https://next.test/page' });
  let result = await env.send({ type: 'frames:scan', tabId: 42 });
  assert.equal(result.ok, false); assert.match(result.error, /도구모음/);
  assert.doesNotMatch(result.error, /Invalid URL/);
  env.permissions.push('webNavigation'); env.frames.splice(0, 1, { frameId: 1, url: 'https://child.test/frame' });
  result = await env.send({ type: 'frames:scan', tabId: 42 });
  assert.equal(result.ok, false); assert.match(result.error, /도구모음/);
  env.chrome.tabs.get = async id => ({ id, url: 'https://[broken' });
  result = await env.send({ type: 'frames:scan', tabId: 42 });
  assert.equal(result.ok, false); assert.match(result.error, /주소를 읽지 못했습니다/);
  assert.throws(() => sitePattern('chrome://extensions'), /일반 웹사이트/);
});
test('recording attaches permitted frames only and connects newly approved frames without resetting the recording', async () => {
  const env = await worker({ permissions: ['webNavigation'], origins: ['https://example.test/*', 'https://known.test/*'], frames: [
    { frameId: 0, url: 'https://example.test/form' }, { frameId: 1, url: 'https://known.test/frame' },
    { frameId: 2, url: 'https://new.test/frame' }
  ] });
  const initial = await env.send({ type: 'recording:start', tabId: 42 });
  assert.ok(initial.ok); const recordingId = initial.value.id;
  assert.deepEqual(env.calls.filter(call => call[0] === 'inject').map(call => call[1].target.frameIds[0]).sort(), [0, 1]);
  env.origins.push('https://new.test/*');
  const result = await env.send({ type: 'studio:activate', tabId: 42, origin: 'https://example.test' });
  assert.ok(result.ok); assert.equal(env.state.macroStudioRecording.id, recordingId);
  assert.equal(env.state.macroStudioRecording.status, 'recording');
  assert.ok(env.state.macroStudioRecording.origins.includes('https://new.test/*'));
  assert.ok(env.calls.some(call => call[0] === 'inject' && call[1].target.frameIds[0] === 2));
  const sender = { ...env.content, frameId: 2, url: 'https://new.test/frame' };
  await env.send({ type: 'capture:event', recordingId, event: { action: 'click', target: { label: 'Open' } } }, sender);
  assert.equal(env.state.macroStudioRecording.steps.length, 1);
  assert.equal(env.state.macroStudioRecording.steps[0].frameId, 2);
  assert.equal((await env.send({ type: 'studio:activate', tabId: 42, origin: 'https://old.test' })).ok, false);
});
test('new frames with an existing grant join the recording; unapproved frames and other tabs cannot join', async () => {
  const env = await worker();
  const started = await env.send({ type: 'recording:start', tabId: 42 });
  const later = { ...env.content, frameId: 7, url: 'https://later.test/form' };
  assert.equal((await env.send({ type: 'capture:status' }, later)).value.recordingId, null);
  env.origins.push('https://later.test/*');
  assert.equal((await env.send({ type: 'capture:status' }, { ...later, tab: { id: 99 } })).value.recordingId, null);
  assert.equal((await env.send({ type: 'capture:status' }, later)).value.recordingId, started.value.id);
  assert.ok(env.state.macroStudioRecording.origins.includes('https://later.test/*'));
  assert.equal((await env.send({ type: 'frames:scan', tabId: 42 })).value.detectionEnabled, false);
});
test('subframe injection failures leave the main recording running, but top-frame failure stops startup', async () => {
  const env = await worker({ permissions: ['webNavigation'], origins: ['https://example.test/*', 'https://known.test/*'], frames: [
    { frameId: 0, url: 'https://example.test/form' }, { frameId: 1, url: 'https://known.test/frame' }
  ] });
  env.chrome.scripting.executeScript = async options => { if (options.target.frameIds[0] === 1) throw new Error('Frame removed'); };
  const started = await env.send({ type: 'recording:start', tabId: 42 });
  assert.ok(started.ok); assert.equal(started.value.status, 'recording'); assert.match(started.value.note, /일부 내부 화면/);
  await env.send({ type: 'recording:stop' });
  env.chrome.scripting.executeScript = async () => { throw new Error('No access'); };
  assert.equal((await env.send({ type: 'recording:start', tabId: 42 })).ok, false);
  assert.equal(env.state.macroStudioRecording.status, 'error');
});
test('script archive persists across workers and sites; only the library can restore or delete registered scripts', async () => {
  const options = { local: {}, catalog: [{ id: 'unist-travel', name: '출장 예제', matches: [
    'https://portal.unist.ac.kr/irj/portal*', 'https://s4hana.unist.ac.kr/sap/*'
  ] }, { id: 'other-task', name: '다른 작업', matches: ['https://other.test/*'] }] };
  let env = await worker(options);
  const portal = { ...env.content, url: 'https://portal.unist.ac.kr/irj/portal' };
  const sap = { ...env.content, url: 'https://s4hana.unist.ac.kr/sap/bc/webdynpro/sap/ZHRW3218' };
  assert.equal((await env.send({ type: 'scripts:archive', id: 'other-task' }, portal)).ok, false);
  assert.equal((await env.send({ type: 'scripts:archive', id: 'missing' })).ok, false);
  assert.equal((await env.send({ type: 'scripts:archive', id: 'unist-travel' }, { ...portal, id: 'other-extension' })).ok, false);
  assert.ok((await env.send({ type: 'scripts:archive', id: 'unist-travel' }, portal)).ok);
  assert.equal((await env.send({ type: 'scripts:state' }, sap)).value.archived[0], 'unist-travel');
  assert.equal((await env.send({ type: 'scripts:state' }, portal)).value.catalog, undefined);
  env = await worker(options);
  assert.equal((await env.send({ type: 'scripts:state' }, sap)).value.archived[0], 'unist-travel');
  for (const type of ['scripts:restore', 'scripts:delete']) assert.equal((await env.send({ type, id: 'unist-travel' }, portal)).ok, false);
  assert.ok((await env.send({ type: 'scripts:restore', id: 'unist-travel' })).ok);
  assert.equal(options.local[LIBRARY_KEY].archived.length, 0);
  assert.equal((await env.send({ type: 'scripts:delete', id: 'unist-travel' })).ok, false);
  await env.send({ type: 'scripts:archive', id: 'unist-travel' });
  const deleted = await env.send({ type: 'scripts:delete', id: 'unist-travel' });
  assert.ok(deleted.ok); assert.ok(!deleted.value.catalog.some(script => script.id === 'unist-travel'));
  env = await worker(options);
  assert.equal((await env.send({ type: 'scripts:state' }, portal)).value.deleted[0], 'unist-travel');
  assert.equal((await env.send({ type: 'scripts:restore', id: 'unist-travel' })).ok, false);
});
test('failed library writes leave scripts available and concurrent changes preserve both items', async () => {
  const env = await worker();
  const save = env.chrome.storage.local.set;
  env.chrome.storage.local.set = async () => { throw new Error('저장 실패'); };
  const failed = await env.send({ type: 'scripts:archive', id: 'weekly-task' });
  assert.equal(failed.ok, false); assert.match(failed.error, /저장 실패/);
  assert.equal((await env.send({ type: 'scripts:state' })).value.archived.length, 0);
  env.chrome.storage.local.set = save;
  const results = await Promise.all(['weekly-task', 'other-task'].map(id => env.send({ type: 'scripts:archive', id })));
  assert.ok(results.every(result => result.ok)); assert.equal(env.local[LIBRARY_KEY].archived.length, 2);
});
test('worker gates controls and capture by sender, tab, origin and recording id; variable conversion drops values', async () => {
  const { state, send, content } = await worker();
  assert.equal((await send({ type: 'recording:start', tabId: 42 }, content)).ok, false);
  const started = await send({ type: 'recording:start', tabId: 42, name: 'test' });
  assert.ok(started.ok); const recordingId = started.value.id;
  assert.equal((await send({ type: 'recording:start', tabId: 42 })).ok, false);
  assert.equal((await send({ type: 'capture:status' }, content)).value.recordingId, recordingId);
  const event = { action: 'input', target: { name: 'visitDate' }, value: 'PRIVATE_DATE' };
  for (const sender of [{ ...content, tab: { id: 43 } }, { ...content, url: 'https://other.test/' }]) {
    assert.ok((await send({ type: 'capture:event', recordingId, event }, sender)).value.ignored);
  }
  assert.ok((await send({ type: 'capture:event', recordingId: 'old', event }, content)).value.ignored);
  await send({ type: 'capture:event', recordingId, event }, content);
  assert.equal(state.macroStudioRecording.steps.length, 1);
  assert.equal(state.macroStudioRecording.steps[0].page.url, 'https://example.test/form');
  assert.equal(state.macroStudioRecording.steps[0].modeSource, 'automatic');
  assert.equal(started.value.stopBefore, DEFAULT_STOP_BEFORE);
  await send({ type: 'recording:stop' });
  const id = state.macroStudioRecording.steps[0].id;
  assert.ok((await send({ type: 'recording:edit', id, mode: 'variable', variable: 'date' })).ok);
  assert.equal(state.macroStudioRecording.steps[0].value, '');
  assert.equal(state.macroStudioRecording.steps[0].modeSource, 'user');
  assert.equal((await send({ type: 'recording:edit', id, mode: 'manual' }, content)).ok, false);
  assert.equal(state.macroStudioRecording.steps[0].mode, 'variable');
  assert.ok((await send({ type: 'recording:edit', id, mode: 'manual' })).ok);
  assert.equal(state.macroStudioRecording.steps[0].modeSource, 'user');
  assert.equal(state.macroStudioRecording.steps[0].mode, 'manual');
  assert.ok(!JSON.stringify(state).includes('PRIVATE_DATE'));
  assert.ok((await send({ type: 'capture:event', recordingId, event }, content)).value.ignored);
  await send({ type: 'recording:clear' }); assert.equal(state.macroStudioRecording, undefined);
});
test('open panel preserves user gesture and recording stops at the bounded step limit', async () => {
  const { state, send, content, calls } = await worker();
  assert.ok((await send({ type: 'studio:open' }, content)).ok);
  assert.equal(calls[0][0], 'open');
  assert.equal((await send({ type: 'studio:open' }, { ...content, frameId: 2 })).ok, false);
  const started = await send({ type: 'recording:start', tabId: 42 });
  state.macroStudioRecording.steps = Array.from({ length: MAX_STEPS - 1 }, () => ({}));
  await send({ type: 'capture:event', recordingId: started.value.id, event: { action: 'click', target: { label: 'Next' } } }, content);
  assert.equal(state.macroStudioRecording.steps.length, MAX_STEPS);
  assert.equal(state.macroStudioRecording.status, 'stopped');
});
test('revoking site access stops active recording', async () => {
  const { state, send, removed } = await worker();
  await send({ type: 'recording:start', tabId: 42 });
  removed[0]();
  await send({ type: 'studio:state' });
  assert.equal(state.macroStudioRecording.status, 'stopped');
  assert.match(state.macroStudioRecording.note, /권한/);
});

test('site toggle persists without scripts, validates origin and permissions, and never opens the panel', async () => {
  const env = await worker({ catalog: [], origins: [], local: {} });
  const change = { type: 'site:set', tabId: 42, origin: 'https://example.test', enabled: true };
  assert.equal((await env.send({ type: 'site:state', tabId: 42 })).value.enabled, false);
  assert.equal((await env.send(change, env.content)).ok, false, 'Only extension UI can change site preferences');
  assert.equal((await env.send(change)).ok, false, 'ON requires persistent host permission');
  assert.equal(env.local[SITES_KEY], undefined);
  env.origins.push('https://example.test/*');
  assert.equal((await env.send({ ...change, origin: 'https://other.test' })).ok, false);
  assert.equal((await env.send({ ...change, enabled: 'true' })).ok, false);
  assert.equal((await env.send(change)).value.enabled, true);
  assert.deepEqual(env.local[SITES_KEY], { 'https://example.test': true });
  assert.equal((await env.send({ type: 'scripts:state' }, env.content)).value.siteEnabled, true);
  assert.equal(env.calls.some(call => call[0] === 'inject'), true);
  assert.equal(env.calls.some(call => call[0] === 'open'), false, 'ON only injects the launcher');
  const restarted = await worker({ catalog: [], local: env.local });
  assert.equal((await restarted.send({ type: 'site:state', tabId: 42 })).value.enabled, true);
  assert.equal((await restarted.send({ ...change, enabled: false })).value.enabled, false);
  assert.equal((await restarted.send({ type: 'scripts:state' }, restarted.content)).value.siteEnabled, false);
  assert.equal(restarted.origins.length, 1, 'OFF remembers the choice without revoking shared frame access');
  const other = { ...restarted.content, url: 'https://other.test/form' };
  assert.equal((await restarted.send({ type: 'scripts:state' }, other)).value.siteEnabled, false);
});

test('explicit ON enables the site, and OFF stops recording without dropping steps', async () => {
  const env = await worker();
  assert.equal((await env.send({ type: 'site:state', tabId: 42 })).value.enabled, true);
  const start = await env.send({ type: 'recording:start', tabId: 42 });
  await env.send({ type: 'capture:event', recordingId: start.value.id, event: { action: 'click', target: { label: '메뉴' } } }, env.content);
  assert.equal((await env.send({ type: 'site:set', tabId: 42, origin: 'https://example.test', enabled: false })).value.enabled, false);
  assert.equal(env.state.macroStudioRecording.status, 'stopped');
  assert.equal(env.state.macroStudioRecording.steps.length, 1);
  assert.equal((await env.send({ type: 'scripts:state' }, env.content)).value.siteEnabled, false);
  assert.match((await env.send({ type: 'recording:start', tabId: 42 })).error, /ON/);
  assert.match((await env.send({ type: 'local:run' }, env.content)).error, /ON/);
  assert.equal((await env.send({ type: 'scripts:state' }, { ...env.content, url: 'https://other.test/form' })).value.siteEnabled, false);
});

test('failed launcher injection does not save ON, and page-scoped scripts agree with the popup', async () => {
  const env = await worker({ catalog: [{ id: 'task', matches: ['https://example.test/other/*'] }], local: {} });
  assert.equal((await env.send({ type: 'site:state', tabId: 42 })).value.enabled, false);
  assert.equal((await env.send({ type: 'scripts:state' }, env.content)).value.siteEnabled, false);
  env.chrome.scripting.executeScript = async () => { throw new Error('Cannot access this page'); };
  assert.equal((await env.send({ type: 'site:set', tabId: 42, origin: 'https://example.test', enabled: true })).ok, false);
  assert.equal(env.local[SITES_KEY], undefined);
});


test('reset preview is read-only and only an explicit own reset-page confirmation clears state', async () => {
  const env = await worker({ permissions: ['webNavigation', 'storage', 'unrelated'], origins: ['https://example.test/*', 'https://extra.test/*'],
    local: { [SITES_KEY]: { 'https://example.test': true }, [LIBRARY_KEY]: { archived: ['weekly-task'], deleted: [] }, macroStudioLocalScripts: { error: 'old' }, unrelated: 'keep' } });
  await env.send({ type: 'recording:start', tabId: 42 });
  env.state.macroStudioRecording.steps.push({ value: 'private recording' });
  env.state.macroStudioStudioDraft = { goal: 'private draft' };
  env.memory.folder = { name: 'local', queryPermission: async () => 'granted' };
  env.memory.snapshot = { scripts: [], entries: [], revision: 'old' };
  const resetPage = { ...env.ui, url: 'chrome-extension://studio/ui/reset.html' };
  assert.equal((await env.send({ type: 'reset:state' }, env.content)).ok, false);
  assert.equal((await env.send({ type: 'reset:state' }, resetPage)).value.steps, 1);
  assert.equal((await env.send({ type: 'reset:state' }, resetPage)).value.scripts, 2, 'Includes bundled and archived scripts, not just imported snapshots');
  assert.equal(env.state.macroStudioRecording.status, 'recording');
  for (const sender of [env.content, env.ui, { ...resetPage, id: 'forged' }]) {
    assert.equal((await env.send({ type: 'reset:confirm', confirmed: true }, sender)).ok, false);
  }
  assert.equal((await env.send({ type: 'reset:confirm' }, resetPage)).ok, false);
  assert.equal((await env.send({ type: 'reset:confirm', confirmed: true }, resetPage)).ok, true);
  assert.equal(env.state.macroStudioRecording, undefined);
  assert.equal(env.state.macroStudioStudioDraft, undefined);
  assert.deepEqual(env.memory, {});
  assert.equal(env.local[SITES_KEY], undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(env.local[LIBRARY_KEY])), { archived: [], deleted: ['weekly-task', 'other-task'] });
  assert.equal((await env.send({ type: 'reset:state' }, resetPage)).value.scripts, 0);
  assert.deepEqual(JSON.parse(JSON.stringify((await env.send({ type: 'scripts:state' })).value.catalog)), []);
  assert.equal(env.local.macroStudioLocalScripts, undefined); assert.equal(env.local.unrelated, 'keep');
  assert.deepEqual(JSON.parse(JSON.stringify(env.calls.find(call => call[0] === 'remove-permissions')[1])), { origins: ['https://extra.test/*'], permissions: ['webNavigation'] });
  assert.equal((await env.send({ type: 'local:sync' })).value.count, 0);
  assert.equal(env.local.macroStudioLocalScripts, undefined, 'An idle sync must not restore deleted sync state');
});

test('bundled UNIST sites stay OFF on a fresh install and after reset despite retained host permissions', async () => {
  const origins = ['https://portal.unist.ac.kr/*', 'https://s4hana.unist.ac.kr/*'];
  const catalog = [{ id: 'unist-travel', name: '출장 예제', matches: origins }];
  for (const origin of origins.map(pattern => pattern.slice(0, -2))) {
    const options = { origins, catalog, local: {} };
    let env = await worker(options);
    const prepare = () => {
      env.chrome.tabs.get = async id => ({ id, url: origin + '/page' });
      env.chrome.runtime.getManifest = () => ({ host_permissions: origins });
      return { ...env.content, url: origin + '/page' };
    };
    let sender = prepare();
    const assertOff = async () => {
      const popup = (await env.send({ type: 'site:state', tabId: 42 })).value;
      assert.equal(popup.allowed, true, 'Permission alone does not imply site opt-in');
      assert.equal(popup.enabled, false);
      const page = (await env.send({ type: 'scripts:state' }, sender)).value;
      assert.ok(page.available.includes('unist-travel'), 'The bundled example is still present');
      assert.equal(page.siteEnabled, false, 'The launcher stays hidden');
      assert.match((await env.send({ type: 'recording:start', tabId: 42 })).error, /ON/);
      assert.match((await env.send({ type: 'studio:activate', tabId: 42, origin })).error, /ON/);
      assert.match((await env.send({ type: 'local:run' }, sender)).error, /ON/);
    };
    await assertOff();
    assert.equal((await env.send({ type: 'site:set', tabId: 42, origin, enabled: true })).value.enabled, true);
    assert.equal((await env.send({ type: 'scripts:state' }, sender)).value.siteEnabled, true);
    const reset = await env.send({ type: 'reset:confirm', confirmed: true }, { ...env.ui, url: 'chrome-extension://studio/ui/reset.html' });
    assert.equal(reset.ok, true, reset.error);
    await env.send({ type: 'local:sync' });
    await assertOff();
    assert.equal((await env.send({ type: 'scripts:state' })).value.catalog.length, 0, 'Reset empties the full library even in an old bundled build');
    env = await worker(options); sender = prepare();
    await assertOff();
    assert.equal((await env.send({ type: 'site:set', tabId: 42, origin, enabled: true })).value.enabled, true);
    assert.equal((await env.send({ type: 'scripts:state' })).value.catalog.length, 0, 'Enabling the site after restart must not restore the deleted example');
    assert.ok((await env.send({ type: 'scripts:state' }, sender)).value.deleted.includes('unist-travel'));
  }
});

test('a permitted child-frame run uses the top-level site opt-in, not a separate child preference', async () => {
  const env = await worker({ origins: ['https://example.test/*', 'https://child.test/*'] });
  const response = await env.send({ type: 'local:run' }, { ...env.content, frameId: 7, url: 'https://child.test/form' });
  assert.equal(response.ok, false);
  assert.match(response.error, /스크립트/); // Site opt-in passes; the missing script is still rejected by the runtime.
  assert.doesNotMatch(response.error, /ON/);
  env.local[SITES_KEY] = {};
  assert.match((await env.send({ type: 'local:run' }, { ...env.content, frameId: 7, url: 'https://child.test/form' })).error, /ON/);
});

test('build changes defer only during active work, then reload without deleting stopped recordings or drafts', async () => {
  const env = await worker();
  await env.lifecycle.installed();
  env.state.macroStudioRecording = { id: 'saved', status: 'recording', steps: [{ value: 'keep' }] };
  env.state.macroStudioStudioDraft = { goal: 'keep my description', variables: 'date' };
  env.diskBuild.id = '1'.repeat(64);
  assert.equal((await env.send({ type: 'update:check' }, env.content)).ok, false, 'Pages cannot trigger extension updates');
  assert.equal((await env.send({ type: 'update:check' })).value.pending, true);
  assert.equal(env.calls.some(call => call[0] === 'reload'), false);
  env.state.macroStudioRecording.status = 'stopped';
  let busy = true;
  env.chrome.scripting.executeScript = async options => options.func ? [{ result: { busy } }] : [];
  assert.equal((await env.send({ type: 'update:check' })).value.pending, true, 'Bundled launcher jobs also defer the reload');
  busy = false;
  assert.equal((await env.send({ type: 'update:check' })).value.applying, true);
  assert.equal(env.calls.filter(call => call[0] === 'reload').length, 1);
  assert.equal(env.state.macroStudioRecording.steps[0].value, 'keep');
  assert.equal(env.state.macroStudioStudioDraft.goal, 'keep my description');
  assert.equal(env.memory.updateSession.macroStudioRecording.steps[0].value, 'keep');
  const restored = await worker({ local: env.local, stored: env.memory });
  assert.equal((await restored.send({ type: 'studio:state' })).value.steps[0].value, 'keep');
  assert.equal(restored.state.macroStudioStudioDraft.goal, 'keep my description');
  assert.equal(restored.memory.updateSession, undefined, 'The temporary checkpoint is removed after restoring into the cleared session');
  assert.equal(env.local[LOADED_BUILD_KEY], '0'.repeat(64));
  assert.ok(env.calls.some(call => call[0] === 'extension-message' && call[1].type === 'update:prepare'));
  assert.match((await env.send({ type: 'recording:start', tabId: 42 })).error, /업데이트/);
});
