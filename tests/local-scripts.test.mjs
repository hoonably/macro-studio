import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { context, code, load, tick } from './helpers.mjs';
import { readScripts, scriptMetadata, scriptsDirectory, LOCAL_KEY } from '../extension/scripts/directory.js';
import { createScriptRuntime } from '../extension/scripts/runtime.js';
import { matchesSite, LIBRARY_KEY } from '../extension/core/script-library.js';

function missing() { const error = new Error('파일 없음'); error.name = 'NotFoundError'; return error; }
function directory(name, entries = {}) {
  return { name, kind: 'directory', entries, permission: 'granted', async queryPermission() { return this.permission; },
    async isSameEntry(other) { return other === this; },
    async *values() { yield* Object.values(this.entries); },
    async getDirectoryHandle(key) { if (this.entries[key]?.kind !== 'directory') throw missing(); return this.entries[key]; },
    async getFileHandle(key) { if (this.entries[key]?.kind !== 'file') throw missing(); return this.entries[key]; }
  };
}
function file(name, text) { return { name, kind: 'file', content: text,
  async getFile() { const content = this.content; return { size: content.length * 2, text: async () => content }; },
  async createWritable() {
    const handle = this; let staged;
    await handle.onOpen?.();
    return {
      async write(value) { if (handle.failWrite) throw new Error('디스크 저장 실패'); staged = value; await handle.onWrite?.(); },
      async close() { handle.content = staged; handle.commits = (handle.commits || 0) + 1; },
      async abort() { handle.aborted = true; }
    };
  }
}; }
function script(id, source, site = 'https://example.test/*', world = 'ISOLATED') {
  return directory(id, { 'script.json': file('script.json', JSON.stringify({ id, name: id, entries: [{ matches: [site], world, adapters: [], files: ['script.js'] }] })), 'script.js': file('script.js', source) });
}
const source = (id, label = '첫 버전', run = 'return "실행 완료";') => `window.MacroStudio.launcher.create().register({id:${JSON.stringify(id)},name:${JSON.stringify(label)},fields:[{name:'date',label:'날짜',value:'2026-10-24'}],async run(values, report){report('진행'); ${run}}});`;

async function runtimeFixture(folder = directory('scripts'), memory = {}, registered = new Map()) {
  memory.folder ||= folder;
  const local = {}, calls = [], origins = ['https://example.test/*'];
  let enabled = true, changed = 0;
  const ui = context(), user = context();
  // Linkedom shares arbitrary Window properties across documents. Model each execution world's globals explicitly.
  for (const env of [ui, user]) {
    const native = env.window;
    const view = { document: ui.document, MacroStudio: { features: {}, config: {} }, innerWidth: 1200, innerHeight: 900,
      Event: native.Event, CustomEvent: native.CustomEvent, MutationObserver: native.MutationObserver,
      localStorage: { getItem: () => null, setItem() {} }, addEventListener: (...args) => native.addEventListener(...args) };
    view.top = view;
    env.ctx.window = env.window = view;
  }
  ui.ctx.CustomEvent = ui.window.CustomEvent; user.ctx.CustomEvent = ui.window.CustomEvent;
  // Both worlds see the same DOM, while their JS globals and MacroStudio objects remain isolated.
  user.ctx.document = ui.document;
  const worlds = { MAIN: ui, ISOLATED: ui, USER_SCRIPT: user };
  const browser = {
    runtime: { id: 'studio', getURL: path => path, getManifest: () => ({ content_scripts: [] }) },
    storage: { local: { get: async key => ({ [key]: local[key] }), set: async values => Object.assign(local, structuredClone(values)), remove: async key => { delete local[key]; } } },
    permissions: { contains: async ({ origins: required = [] }) => required.every(value => origins.some(pattern => matchesSite(pattern, value))) },
    userScripts: {
      getScripts: async () => { if (!enabled) throw new Error('허용 필요'); return structuredClone([...registered.values()]); },
      register: async definitions => {
        definitions.forEach(item => { new vm.Script(item.js[0].code); assert.equal(registered.has(item.id), false); });
        definitions.forEach(item => registered.set(item.id, structuredClone(item))); calls.push(['register', definitions.length]);
      },
      update: async definitions => {
        definitions.forEach(item => { new vm.Script(item.js[0].code); assert.equal(registered.has(item.id), true); });
        definitions.forEach(item => registered.set(item.id, structuredClone(item))); calls.push(['update', definitions.length]);
      },
      unregister: async ({ ids }) => { ids.forEach(id => registered.delete(id)); calls.push(['unregister', ids]); },
      execute: async injection => {
        if (!enabled) throw new Error('허용 필요');
        calls.push(['execute', injection.world]);
        try { return [{ frameId: injection.target.frameIds[0], result: await vm.runInContext(injection.js.map(item => item.code).join('\n;\n'), worlds[injection.world].ctx) }]; }
        catch (error) { return [{ frameId: injection.target.frameIds[0], error: error.message }]; }
      }
    },
    scripting: { executeScript: async injection => {
      calls.push(['mount', injection.world]);
      const env = worlds[injection.world];
      if (injection.files) await load(env.ctx, ...injection.files.map(path => 'extension/' + path));
      else vm.runInContext('(' + injection.func.toString() + ')(' + JSON.stringify(injection.args[0]) + ')', env.ctx);
      return [];
    } }
  };
  const options = { read: async key => memory[key], write: async values => Object.assign(memory, values), clear: async () => { for (const key of Object.keys(memory)) delete memory[key]; }, resource: path => code('extension/' + path), changed: async () => { changed++; } };
  const runtime = createScriptRuntime(browser, options);
  const sender = { id: 'studio', tab: { id: 42 }, frameId: 0, url: 'https://example.test/form' };
  return { folder, memory, local, calls, origins, browser, runtime, options, registered, ui, user, sender, getChanged: () => changed, enable: value => { enabled = value; } };
}

test('directory sync reads only declared scripts, validates paths, and keeps the last valid file during partial saves', async () => {
  const task = script('task', source('task')), dir = directory('scripts', { task, '.hidden': directory('.hidden') });
  task.entries['private.txt'] = file('private.txt', 'DO_NOT_READ');
  const first = await readScripts(dir);
  assert.equal(first.scripts.length, 1); assert.deepEqual(Object.keys(first.scripts[0].files), ['script.js']);
  task.entries['script.json'].content = '{partial';
  const partial = await readScripts(dir, first.scripts);
  assert.deepEqual(partial.scripts, first.scripts); assert.equal(partial.errors.length, 1);
  delete dir.entries.task;
  assert.equal((await readScripts(dir, first.scripts)).scripts.length, 0, 'Removing the whole script folder removes its imported entry');
  assert.throws(() => scriptMetadata({ id: 'task', entries: [{ matches: ['https://example.test/*'], files: ['../private.js'] }] }, 'task'), /폴더/);
  assert.throws(() => scriptMetadata({ id: 'task', entries: [{ matches: ['<all_urls>'] }] }, 'task'), /사이트/);
  assert.throws(() => scriptMetadata({ id: 'task', entries: [{ matches: ['https://example.test/*'], adapters: ['sap'] }] }, 'task'), /MAIN/);
  const root = directory('repository', { local: directory('local', { scripts: dir }) });
  assert.equal(await scriptsDirectory(root), dir);
  const empty = directory('MyMacros');
  assert.equal(await scriptsDirectory(empty), empty, 'An empty chosen folder can be connected before generation');
});

test('standalone wrapper folders resolve and new incomplete macros report the missing file', async () => {
  const task = script('task', source('task')), nested = directory('scripts', { task });
  assert.equal(await scriptsDirectory(directory('MyMacros', { scripts: nested })), nested);
  delete task.entries['script.js'];
  assert.match((await readScripts(nested)).errors[0].message, /script.js/);
  task.entries['script.js'] = file('script.js', source('task'));
  delete task.entries['script.json'];
  assert.match((await readScripts(nested)).errors[0].message, /script.json/);
  await assert.rejects(scriptsDirectory(script('task', source('task'))), /상위|위의/);
});

test('a connected empty folder detects a later wrapper and keeps its confirmed path private', async () => {
  const folder = directory('MyMacros'), env = await runtimeFixture(folder, { folderPath: '/Users/example/MyMacros' });
  assert.equal((await env.runtime.sync()).count, 0);
  folder.entries.scripts = directory('scripts', { task: script('task', source('task')) });
  const state = await env.runtime.sync();
  assert.equal(state.count, 1);
  assert.deepEqual(state.folderRelativePath, ['scripts']);
  assert.equal(state.folderPath, '/Users/example/MyMacros');
  assert.ok(!JSON.stringify(env.local).includes('/Users/example'), 'The OS path is not broadcast to page-facing storage');
});

test('source changes register without extension reload, mount on an existing page, and survive a worker restart', async () => {
  const env = await runtimeFixture(directory('scripts', { task: script('task', source('task')) }));
  assert.equal((await env.runtime.sync()).count, 1);
  assert.equal(env.registered.size, 1); assert.equal(env.getChanged(), 1);
  await env.runtime.sync();
  assert.equal(env.calls.filter(call => call[0] === 'update').length, 0, 'Unchanged code does not update on every poll');
  assert.equal(env.calls.filter(call => call[0] === 'execute').length, 0, 'Saving code never executes a workflow');
  await env.runtime.connect(env.sender);
  const app = env.ui.window.MacroStudio.launcher.app;
  app.applyLibraryState({ ready: true, available: ['task'], archived: [], deleted: [] });
  const host = env.ui.document.getElementById('macro-studio-launcher');
  assert.equal(host.hidden, false); assert.equal(host.shadowRoot.querySelector('strong').textContent, 'Macro Studio');
  assert.equal(host.shadowRoot.querySelector('.script-copy strong').textContent, 'task');
  const oldRevision = env.memory.snapshot.entries[0].revision;
  env.folder.entries.task.entries['script.js'].content = source('task', '수정 버전');
  const metadata = JSON.parse(env.folder.entries.task.entries['script.json'].content);
  env.folder.entries.task.entries['script.json'].content = JSON.stringify({...metadata,name:'수정 버전'});
  await env.runtime.sync(); await env.runtime.connect(env.sender);
  assert.equal(host.shadowRoot.querySelectorAll('.script').length, 1, 'Updating an id replaces it instead of adding duplicate buttons');
  assert.equal(host.shadowRoot.querySelector('.script-copy strong').textContent, '수정 버전');
  assert.notEqual(env.memory.snapshot.entries[0].revision, oldRevision);
  const catalog = await env.runtime.catalog([{ id: 'builtin' }, { id: 'old', bundled: true }]);
  assert.deepEqual(catalog.map(item => item.id), ['builtin', 'task']);
  const reloaded = createScriptRuntime(env.browser, env.options);
  env.registered.clear(); await reloaded.sync();
  assert.equal(env.registered.size, 1, 'Stored sources restore registrations after extension updates');
  delete env.folder.entries.task; await reloaded.sync();
  assert.equal(env.registered.size, 0);
  app.applyLibraryState({ ready: true, available: [], archived: [], deleted: [] });
  assert.equal(host.hidden, true, 'Removed scripts cannot leave a stale visible launcher');
});

test('MAIN scripts reuse site features without replacing the page launcher or leaking their private feature namespace', async () => {
  const env = await runtimeFixture(directory('scripts', { task: script('task', `const helper = window.MacroStudio;
    helper.features.privateTask ||= {};
    helper.features.privateTask.value = 'LOCAL_ONLY';
    helper.launcher.create().register({id:'task',name:'주입',run(){return helper.features.site.run() + helper.features.privateTask.value;}});`, 'https://example.test/*', 'MAIN') }));
  env.browser.runtime.getManifest = () => ({ content_scripts: [{ world: 'MAIN', matches: ['https://example.test/*'] }] });
  await load(env.ui.ctx, 'extension/core/namespace.js', 'extension/ui/launcher.js');
  const original = env.ui.window.MacroStudio, originalApp = original.launcher.create();
  original.features.privateTask = { value: 'SHARED' };
  await env.runtime.sync(); await env.runtime.connect(env.sender);
  assert.equal(env.ui.window.MacroStudio, original); assert.equal(original.launcher.app, originalApp);
  assert.equal(original.features.privateTask.value, 'SHARED');
  original.features.site = { run: () => 'SITE_' }; // Site adapters can finish loading after the registration.
  const entry = env.memory.snapshot.entries[0];
  assert.equal(await env.runtime.run({ id: 'task', key: entry.key, revision: entry.revision, requestId: 'test', values: {} }, env.sender), 'SITE_LOCAL_ONLY');
});

test('isolated run bridge rejects forged DOM requests and accepts a real launcher submission only', async () => {
  const code = source('task', '클릭 테스트', 'window.runCount = (window.runCount || 0) + 1; return values.date;')
    .replace("fields:[{name:'date',label:'날짜',value:'2026-10-24'}]", "fields:[{name:'date',label:'날짜',value:'2026-10-24'},{name:'time',label:'시간',type:'select',value:'09:00',options:[{value:'09:00',label:'오전 9:00'}]}]");
  const env = await runtimeFixture(directory('scripts', { task: script('task', code) }));
  await env.runtime.sync();
  let runRequests = 0;
  env.ui.ctx.MutationObserver = env.ui.window.MutationObserver;
  env.ui.ctx.chrome = { ...env.browser,
    runtime: { ...env.browser.runtime, onMessage: { addListener() {} }, sendMessage: async message => {
      if (message.type === 'local:connect') return { ok: true, value: await env.runtime.connect(env.sender) };
      if (message.type === 'local:run') { runRequests++; return { ok: true, value: await env.runtime.run(message, env.sender) }; }
      return { ok: true, value: { ready: true, available: ['task'], archived: [], deleted: [] } };
    } }, storage: { ...env.browser.storage, onChanged: { addListener() {} } }
  };
  await load(env.ui.ctx, 'extension/core/namespace.js', 'extension/ui/launcher.js');
  env.ui.window.MacroStudio.launcher.create();
  const initialRoot = env.ui.document.getElementById('macro-studio-launcher').shadowRoot;
  const listen = initialRoot.addEventListener.bind(initialRoot);
  let captureSubmit;
  initialRoot.addEventListener = (type, listener, options) => { if (type === 'submit' && options === true) captureSubmit = listener; listen(type, listener, options); };
  await load(env.ui.ctx, 'extension/core/studio-entry.js'); await tick();
  const host = env.ui.document.getElementById('macro-studio-launcher'), root = host.shadowRoot;
  for (let attempt = 0; attempt < 50 && !root.querySelector('.script'); attempt++) await tick();
  assert.ok(root.querySelector('.script'), root.querySelector('.list-status').textContent);
  const entry = env.memory.snapshot.entries[0];
  host.dispatchEvent(new env.ui.window.CustomEvent('macro-studio:script-run', { detail: JSON.stringify({ id: 'task', key: entry.key, revision: entry.revision, requestId: 'forged', values: { date: '2026-10-24' } }) }));
  await tick(); assert.equal(runRequests, 0);
  root.querySelector('.script').click();
  const form = root.querySelector('form'); form.reportValidity = () => true;
  form.dispatchEvent(new env.ui.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
  assert.equal(runRequests, 0, 'A synthetic submission cannot execute imported code');
  assert.match(root.querySelector('output').textContent, /직접 눌러/);
  // Linkedom does not model capture-phase ordering. Feed the trusted capture event first, as Chrome does.
  captureSubmit({ isTrusted: true, target: form });
  await Promise.resolve(); // Chrome may flush microtasks between listeners in different worlds.
  form.dispatchEvent(new env.ui.window.Event('submit', { cancelable: true }));
  await tick();
  assert.equal(runRequests, 1, root.querySelector('output').textContent); assert.equal(env.user.window.runCount, 1);
  captureSubmit({ isTrusted: true, target: form });
  await tick();
  host.dispatchEvent(new env.ui.window.CustomEvent('macro-studio:script-run', { detail: JSON.stringify({ id: 'task', key: entry.key, revision: entry.revision, requestId: 'expired', values: { date: form.querySelector('input').value } }) }));
  await tick(); assert.equal(runRequests, 1, 'A previous task cannot authorize a later run');
});

test('bad JavaScript, failed writes and permission changes preserve working scripts and never request access automatically', async () => {
  const env = await runtimeFixture(directory('scripts', { task: script('task', source('task')) }));
  await env.runtime.sync(); const revision = env.memory.snapshot.revision, working = [...env.registered.values()][0].js[0].code;
  env.folder.entries.task.entries['script.js'].content = 'broken(';
  assert.ok((await env.runtime.sync()).error);
  assert.equal(env.memory.snapshot.revision, revision); assert.equal([...env.registered.values()][0].js[0].code, working);
  env.folder.entries.task.entries['script.js'].content = source('task', '새 버전');
  const broken = createScriptRuntime(env.browser, { ...env.options, write: async () => { throw new Error('쓰기 실패'); } });
  assert.match((await broken.sync()).error, /쓰기 실패/);
  assert.equal(env.memory.snapshot.revision, revision); assert.equal([...env.registered.values()][0].js[0].code, working);
  env.folder.permission = 'prompt';
  assert.equal((await env.runtime.sync()).readable, false); assert.equal(env.memory.snapshot.revision, revision);
  env.enable(false); assert.equal((await env.runtime.status()).enabled, false);
  assert.equal((await env.runtime.catalog([]))[0].unavailable, true);
  env.enable(true); env.folder.permission = 'granted';
  env.folder.entries.other = script('other', source('other'), 'https://new.test/*');
  const status = await env.runtime.sync();
  assert.deepEqual(status.missingOrigins, ['https://new.test/*']);
  assert.equal(env.registered.size, 1, 'New sites stay unregistered until the user grants them');
  env.origins.push('https://new.test/*'); await env.runtime.sync(); assert.equal(env.registered.size, 2);
  env.local[LIBRARY_KEY] = { archived: [], deleted: ['task'] }; await env.runtime.sync();
  assert.equal(env.registered.size, 1, 'Deleted ids are not revived by saving or reconnecting a folder');
  assert.ok(!JSON.stringify(env.local[LOCAL_KEY]).includes('async run'), 'Code is kept in extension IndexedDB, not broadcast storage');
});

test('runs validate site and revision, refuse archived scripts and defer changed code until the active task ends', async () => {
  const env = await runtimeFixture(directory('scripts', { task: script('task', source('task', '대기', 'await new Promise(resolve => window.release = resolve); return values.date;')) }));
  await env.runtime.sync(); await env.runtime.connect(env.sender);
  const entry = env.memory.snapshot.entries[0], message = { id: 'task', key: entry.key, revision: entry.revision, requestId: 'job-1', values: { date: '2026-10-24' } };
  await assert.rejects(env.runtime.run(message, { ...env.sender, url: 'https://attacker.test/' }), /사용할 수 없/);
  await assert.rejects(env.runtime.run({ ...message, revision: 'old' }, env.sender), /변경/);
  env.local[LIBRARY_KEY] = { archived: ['task'], deleted: [] };
  await assert.rejects(env.runtime.run(message, env.sender), /사용할 수 없/);
  env.local[LIBRARY_KEY] = { archived: [], deleted: [] };
  const running = env.runtime.run(message, env.sender); await tick();
  assert.equal(await env.runtime.whenIdle(() => assert.fail('Running scripts must defer the extension update')), false);
  await assert.rejects(env.runtime.rename('task', '실행 중 수정'), /실행 중인 매크로/);
  await assert.rejects(env.runtime.run(message, env.sender), /이미 실행/);
  env.folder.entries.task.entries['script.js'].content = source('task', '작업 후 반영');
  assert.equal((await env.runtime.sync()).revision, env.memory.snapshot.revision);
  assert.equal(env.memory.snapshot.entries[0].revision, entry.revision);
  vm.runInContext('window.release()', env.user.ctx);
  assert.equal(await running, '2026-10-24');
  const beforeReload = env.memory.snapshot;
  assert.equal(await env.runtime.whenIdle(async () => {
    await assert.rejects(env.runtime.connect(env.sender), /초기화/);
    return true;
  }), true);
  assert.equal(env.memory.snapshot, beforeReload, 'Preparing a reload must not clear imported source or registration');
  await env.runtime.sync(); assert.notEqual(env.memory.snapshot.entries[0].revision, entry.revision);
});


test('missing permissions for an internal entry block the whole macro before any execution', async () => {
  const task = script('task', source('task'));
  const manifest = JSON.parse(task.entries['script.json'].content);
  manifest.entries.push({ ...manifest.entries[0], matches:['https://internal.test/*'], allFrames:true });
  task.entries['script.json'].content = JSON.stringify(manifest);
  const env = await runtimeFixture(directory('scripts', { task }));
  await env.runtime.sync(); await env.runtime.connect(env.sender);
  assert.equal((await env.runtime.catalog([]))[0].unavailable, true);
  const entry = env.memory.snapshot.entries[0];
  const request = { id:'task',key:entry.key,revision:entry.revision,requestId:'internal',values:{} };
  const executions = env.calls.filter(call => call[0] === 'execute').length;
  await assert.rejects(env.runtime.run(request, env.sender), /내부 화면 접근.*internal.test/);
  assert.equal(env.calls.filter(call => call[0] === 'execute').length, executions);
  assert.equal((await env.runtime.status()).running, false);
  env.origins.push('https://internal.test/*');
  await env.runtime.sync();
  assert.equal((await env.runtime.catalog([]))[0].unavailable, false);
  assert.equal(await env.runtime.run(request, env.sender), '실행 완료');
});

test('select fields preserve complete labels and string values through the personal script bridge', async () => {
  const code = `window.MacroStudio.launcher.create().register({ id:'task', name:'시간 선택',
    fields:[{name:'time',label:'시작 시간',type:'select',required:true,value:'09:30',
      options:[{value:'09:30',label:'오전 9:30'},{value:'14:00',label:'오후 2:00 <b>표기</b>'}]}],
    async run(values){return values.time;} });`;
  const env = await runtimeFixture(directory('scripts', { task: script('task', code) }));
  await env.runtime.sync(); await env.runtime.connect(env.sender);
  const entry = env.memory.snapshot.entries[0];
  const results = await env.browser.userScripts.execute({ target:{frameIds:[0]}, world:entry.world,
    js:[{code:entry.code}] });
  const field = results[0].result[0].fields[0];
  assert.equal(field.type, 'select');
  assert.equal(field.required, true);
  assert.equal(field.value, '09:30');
  assert.equal(field.options.length, 2);
  assert.equal(field.options[1].label, '오후 2:00 <b>표기</b>');
  assert.equal(field.options[1].value, '14:00');
  const shadow = env.ui.document.getElementById('macro-studio-launcher').shadowRoot;
  env.ui.window.MacroStudio.launcher.create().applyLibraryState({ ready: true, archived: [], deleted: [] });
  shadow.querySelector('[data-script-id="task"]').click();
  const select = shadow.querySelector('select[name="time"]');
  assert.equal(select.value, '09:30');
  assert.equal(select.options.length, 3);
  assert.equal(select.options[2].textContent, '오후 2:00 <b>표기</b>');
  assert.equal(select.querySelector('b'), null, 'Choice labels are never inserted as HTML');
  assert.equal(await env.runtime.run({ id:'task', key:entry.key, revision:entry.revision,
    requestId:'choice', values:{time:'14:00'} }, env.sender), '14:00');
});

test('missing execution results reject instead of reporting success and release the run lock', async () => {
  const env = await runtimeFixture(directory('scripts', { task: script('task', source('task')) }));
  await env.runtime.sync(); await env.runtime.connect(env.sender);
  const entry = env.memory.snapshot.entries[0];
  const message = { id: 'task', key: entry.key, revision: entry.revision, requestId: 'result-check', values: {} };
  const execute = env.browser.userScripts.execute;
  for (const result of [[], [{ frameId: 0 }], [{ frameId: 0, result: null }], [{ frameId: 0, result: {} }], [{ frameId:0, result:'old completion' }]]) {
    env.browser.userScripts.execute = async () => result;
    await assert.rejects(env.runtime.run(message, env.sender), /실행 완료를 확인하지 못/);
    assert.equal((await env.runtime.status()).running, false);
  }
  env.browser.userScripts.execute = async () => [{ frameId: 0, error: '실제 입력 실패' }];
  await assert.rejects(env.runtime.run(message, env.sender), /실제 입력 실패/);
  env.browser.userScripts.execute = execute;
  assert.equal(await env.runtime.run(message, env.sender), '실행 완료');
  env.folder.entries.task.entries['script.js'].content = source('task', '반환값 없음', '');
  await env.runtime.sync(); await env.runtime.connect(env.sender);
  const updated = env.memory.snapshot.entries[0];
  assert.equal(await env.runtime.run({ ...message, revision: updated.revision }, env.sender), '완료했습니다.');
  env.folder.entries.task.entries['script.js'].content = source('task', '비동기 오류', 'await Promise.resolve(); throw new Error("입력 반영 실패");');
  await env.runtime.sync(); await env.runtime.connect(env.sender);
  const failed = env.memory.snapshot.entries[0];
  await assert.rejects(env.runtime.run({ ...message, revision:failed.revision }, env.sender), /입력 반영 실패/);
});

test('reset drains a concurrent sync, removes imported sources and registrations, and cannot rehydrate', async () => {
  const env = await runtimeFixture(directory('scripts', { task: script('task', source('task')) }));
  let release, entered;
  const reached = new Promise(resolve => { entered = resolve; });
  const original = env.browser.userScripts.register;
  env.browser.userScripts.register = async definitions => { entered(); await new Promise(resolve => { release = resolve; }); return original(definitions); };
  const syncing = env.runtime.sync(); await reached;
  const resetting = env.runtime.reset(async () => 'done');
  await assert.rejects(env.runtime.sync(), /초기화/);
  await assert.rejects(env.runtime.connect(env.sender), /초기화/);
  release(); await syncing; assert.equal(await resetting, 'done');
  assert.deepEqual(env.memory, {}); assert.equal(env.registered.size, 0);
  assert.equal(env.local[LOCAL_KEY], undefined);
  assert.equal((await env.runtime.sync()).count, 0);
  assert.equal(env.registered.size, 0); assert.equal(env.local[LOCAL_KEY], undefined);
});

test('reset refuses running jobs and unavailable cleanup without deleting their source snapshot', async () => {
  const env = await runtimeFixture(directory('scripts', { task: script('task', source('task')) }));
  await env.runtime.sync(); await env.runtime.connect(env.sender);
  const entry = env.memory.snapshot.entries[0];
  let release, entered;
  const reached = new Promise(resolve => { entered = resolve; });
  env.browser.userScripts.execute = async () => { entered(); return new Promise(resolve => { release = () => resolve([{ result: JSON.stringify({ protocol:'macro-studio-run-v1', status:'completed', value:'done' }) }]); }); };
  const run = env.runtime.run({ id: 'task', key: entry.key, revision: entry.revision, requestId: 'test', values: {} }, env.sender);
  await reached;
  await assert.rejects(env.runtime.reset(async () => {}), /실행 중/);
  assert.ok(env.memory.snapshot); assert.equal(env.registered.size, 1);
  release(); await run;
  env.enable(false);
  await assert.rejects(env.runtime.reset(async () => {}), /사용자 스크립트 허용/);
  assert.ok(env.memory.snapshot);
  env.enable(true);
  await env.runtime.reset(async () => {});
  assert.equal(env.memory.snapshot, undefined); assert.equal(env.registered.size, 0);
});

test('renaming saves only metadata, refreshes the launcher name, and survives a new runtime', async () => {
  const task = script('task', source('task'));
  const metadata = task.entries['script.json'], before = JSON.parse(metadata.content), originalCode = task.entries['script.js'].content;
  const env = await runtimeFixture(directory('scripts', {task}), {folderPath:'/Users/example/scripts'});
  await env.runtime.sync();
  const previous = env.memory.snapshot.entries[0].revision;
  assert.equal((await env.runtime.status()).writable, true);
  await env.runtime.rename('task', '새 매크로 이름');
  assert.deepEqual(JSON.parse(metadata.content), {...before,name:'새 매크로 이름'});
  assert.equal(task.entries['script.js'].content, originalCode);
  assert.notEqual(env.memory.snapshot.entries[0].revision, previous);
  const connected = await env.runtime.connect(env.sender);
  assert.equal(connected.error, '');
  const stored = env.user.window.__macroStudioLocalRegistry.get('task/0');
  assert.equal(stored.definitions.get('task').name, '첫 버전', 'The original script remains unchanged');
  const catalog = await createScriptRuntime(env.browser, env.options).catalog([]);
  assert.equal(catalog[0].name, '새 매크로 이름');
  const host = env.ui.document.getElementById('macro-studio-launcher');
  env.ui.window.MacroStudio.launcher.app.applyLibraryState({ready:true,available:['task'],archived:[],deleted:[]});
  assert.equal(host.shadowRoot.querySelector('.script-copy strong').textContent, '새 매크로 이름');
});

test('rename rejects revoked write access, invalid names and ids, and preserves files after write failures or concurrent edits', async () => {
  const task = script('task', source('task')), folder = directory('scripts', {task});
  const env = await runtimeFixture(folder, {folderPath:'/Users/example/scripts'});
  await env.runtime.sync();
  const metadata = task.entries['script.json'], original = metadata.content;
  folder.queryPermission = async ({mode}) => mode === 'readwrite' ? 'prompt' : 'granted';
  assert.equal((await env.runtime.status()).readable, true);
  assert.equal((await env.runtime.status()).writable, false);
  await assert.rejects(env.runtime.rename('task','변경'), /사용 준비/);
  folder.queryPermission = async () => 'granted';
  for (const [id,name] of [['../task','이름'],['task',' '],['task','a'.repeat(101)],['task','두\n줄']]) await assert.rejects(env.runtime.rename(id,name));
  assert.equal(metadata.content,original);
  metadata.failWrite = true;
  await assert.rejects(env.runtime.rename('task','새 이름'), /디스크 저장 실패/);
  assert.equal(metadata.content,original); assert.equal(metadata.aborted,true);
  metadata.failWrite = false;
  metadata.onWrite = async () => { metadata.content = JSON.stringify({...JSON.parse(original),name:'외부 편집'}); };
  await assert.rejects(env.runtime.rename('task','새 이름'), /변경됐습니다/);
  assert.equal(JSON.parse(metadata.content).name,'외부 편집');
  assert.equal(metadata.commits,undefined);
});

test('common field controls support up to sixty exposed knobs without truncating execution values at thirty',async()=>{
 const source=`window.MacroStudio.launcher.create().register({id:'task',name:'다수 입력',fields:Array.from({length:65},(_,i)=>({name:'field'+i,label:'항목 '+i,value:String(i)})),async run(values){return String(Object.keys(values).length);}});`;
 const env=await runtimeFixture(directory('scripts',{task:script('task',source)}));await env.runtime.sync();await env.runtime.connect(env.sender);
 const app=env.ui.window.MacroStudio.launcher.app;app.applyLibraryState({ready:true,available:['task'],archived:[],deleted:[]});
 const root=env.ui.document.getElementById('macro-studio-launcher').shadowRoot;root.querySelector('.script').click();
 assert.equal(root.querySelectorAll('.fields input').length,60);
 const entry=env.memory.snapshot.entries[0],values=Object.fromEntries(Array.from({length:60},(_,i)=>['field'+i,String(i)]));
 const message={id:'task',key:entry.key,revision:entry.revision,requestId:'many-fields',values};
 assert.equal(await env.runtime.run(message,env.sender),'60');
 await assert.rejects(env.runtime.run({...message,values:{...values,extra:'61'}},env.sender),/입력값/);
});
