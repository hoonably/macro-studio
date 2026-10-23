import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { context, code, load, tick } from './helpers.mjs';
import { LIBRARY_KEY, changeLibrary, matchesSite } from '../extension/core/script-library.js';

test('launcher waits for storage, blocks archived/stale runs, restores items and disables management while running', async () => {
  const { ctx, window, document } = context();
  window.MacroStudio = { features: {} };
  await load(ctx, 'extension/ui/launcher.js');
  const app = window.MacroStudio.launcher.create(), host = document.getElementById('macro-studio-launcher'), shadow = host.shadowRoot;
  assert.equal(host.hidden, true);
  assert.equal(host.style.display, 'none');
  let runs = 0, release;
  app.register({ id: 'task', name: '테스트', run: () => { runs++; return new Promise(resolve => { release = resolve; }); } });
  assert.equal(shadow.querySelectorAll('.script').length, 0);
  assert.equal(host.hidden, true, 'No icon flashes before stored deletion state is loaded');
  app.applyLibraryState({ ready: true, archived: [], deleted: [] });
  assert.equal(host.hidden, false);
  const stale = shadow.querySelector('.script'); stale.click();
  const form = shadow.querySelector('form'); form.reportValidity = () => true;
  app.applyLibraryState({ ready: true, archived: ['task'], deleted: [] });
  assert.equal(host.hidden, false, 'Archived scripts keep library access available');
  stale.click(); form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.equal(runs, 0); assert.equal(shadow.querySelectorAll('.script').length, 0);
  assert.equal(shadow.querySelector('.config').hidden, true);
  app.applyLibraryState({ ready: true, archived: [], deleted: [] });
  shadow.querySelector('.script').click(); form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.equal(runs, 1); assert.equal(shadow.querySelector('.script-archive').disabled, true);
  app.applyLibraryState({ ready: true, archived: [], deleted: ['task'] });
  assert.equal(host.hidden, false, 'Deleting from another tab does not hide an in-progress task');
  release(); await tick();
  assert.equal(shadow.querySelectorAll('.script').length, 0);
  assert.equal(host.hidden, true);
  assert.equal(host.style.display, 'none');
  form.dispatchEvent(new window.Event('submit', { cancelable: true })); assert.equal(runs, 1);
});

test('empty and fully deleted sites stay hidden after loading; a new script makes the icon appear', async () => {
  const { ctx, window, document } = context();
  window.MacroStudio = { features: {} };
  await load(ctx, 'extension/ui/launcher.js');
  const app = window.MacroStudio.launcher.create(), host = document.getElementById('macro-studio-launcher');
  app.applyLibraryState({ ready: true, archived: [], deleted: [] });
  assert.equal(host.hidden, true, 'A site with no macros uses the Chrome toolbar to start recording');
  app.applyLibraryState({ ready: true, archived: [], deleted: ['old-task'] });
  app.register({ id: 'old-task', name: '삭제한 작업', run: async () => {} });
  assert.equal(host.hidden, true, 'Loading the original source cannot revive a deleted script');
  app.register({ id: 'new-task', name: '새 작업', run: async () => {} });
  assert.equal(host.hidden, false);
  assert.equal(host.style.display, 'block');
  host.shadowRoot.querySelector('.orb').click();
  assert.equal(host.shadowRoot.querySelector('.panel').hidden, false);
  app.applyLibraryState({ ready: true, archived: [], deleted: ['old-task', 'new-task'] });
  assert.equal(host.hidden, true);
  assert.equal(host.shadowRoot.querySelector('.panel').hidden, true, 'Removing the last script also closes its menu');
});

test('isolated bridge archives only trusted clicks in its launcher and reports write failures', async () => {
  const { ctx, window, document } = context();
  window.MacroStudio = { features: {} }; delete window.__macroStudioEntryInstalled;
  let state = { ready: true, archived: [], deleted: [] }, fail = false, changes, approveArchive = false;
  const calls = [];
  const confirmations = [];
  window.confirm = message => { confirmations.push(message); return approveArchive; };
  ctx.CustomEvent = window.CustomEvent; ctx.MutationObserver = window.MutationObserver;
  ctx.chrome = {
    runtime: { onMessage: { addListener() {} }, getManifest: () => ({ content_scripts: [{ world: 'MAIN', matches: ['https://example.test/*'] }] }),
      sendMessage: async message => {
        calls.push(message);
        if (message.type === 'scripts:archive') {
          if (fail) return { ok: false, error: '저장 실패' };
          state = { ready: true, ...changeLibrary(state, 'archive', message.id) };
        }
        return { ok: true, value: structuredClone(state) };
      } },
    storage: { onChanged: { addListener: listener => { changes = listener; } } }
  };
  await load(ctx, 'extension/ui/launcher.js');
  const app = window.MacroStudio.launcher.create();
  app.register({ id: 'task', name: '테스트', run: async () => {} });
  await load(ctx, 'extension/core/studio-entry.js'); await tick();
  const host = document.getElementById('macro-studio-launcher'), shadow = host.shadowRoot;
  const click = (button, trusted) => {
    const event = new window.Event('click', { cancelable: true });
    Object.defineProperty(event, 'isTrusted', { value: trusted });
    event.composedPath = () => [button, shadow, host, document, window];
    document.dispatchEvent(event);
  };
  click(shadow.querySelector('.script-archive'), false); await tick();
  assert.equal(calls.filter(call => call.type === 'scripts:archive').length, 0);
  assert.equal(confirmations.length, 0, 'Synthetic clicks do not open confirmation');
  click(shadow.querySelector('.script-archive'), true); await tick();
  assert.equal(confirmations.length, 1);
  assert.match(confirmations[0], /테스트/);
  assert.equal(calls.filter(call => call.type === 'scripts:archive').length, 0, 'Cancel keeps the script active');
  approveArchive = true;
  host.dispatchEvent(new window.CustomEvent('macro-studio:library-state', { detail: JSON.stringify({ ready: true, archived: ['task'], deleted: [] }) }));
  assert.equal(calls.filter(call => call.type === 'scripts:archive').length, 0, 'Presentation events cannot mutate storage');
  changes({ [LIBRARY_KEY]: {} }, 'local'); await tick();
  fail = true; click(shadow.querySelector('.script-archive'), true); await tick();
  assert.match(shadow.querySelector('.list-status').textContent, /저장 실패/);
  assert.ok(shadow.querySelector('.script'));
  fail = false; click(shadow.querySelector('.script-archive'), true); await tick();
  assert.equal(shadow.querySelectorAll('.script').length, 0);
  assert.deepEqual(state.archived, ['task']);
  state.archived = []; changes({ [LIBRARY_KEY]: {} }, 'local'); await tick();
  assert.ok(shadow.querySelector('.script'), 'Restoring in the library updates open page lists');
});

test('library screen archives and restores; deletion requires confirmation and a failed save stays recoverable', async () => {
  const { ctx, window, document } = context(await code('extension/ui/library.html'));
  const catalog = [{ id: 'task', name: '<img src=x> 예제', matches: ['https://example.test/*'] }];
  let state = { ready: true, catalog, archived: [], deleted: [] }, fail = false, approveArchive = false;
  window.confirm = () => approveArchive;
  const calls = [], dialog = document.getElementById('delete-dialog');
  dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; };
  ctx.URL = URL; ctx.chrome = {
    runtime: { sendMessage: async message => {
      calls.push(message);
      if (message.type !== 'scripts:state') {
        if (fail) return { ok: false, error: '저장 실패' };
        state = { ready: true, ...changeLibrary(state, message.type.slice(8), message.id), catalog };
      }
      return { ok: true, value: structuredClone(state) };
    } }, storage: { onChanged: { addListener() {} } }
  };
  await vm.runInContext('(async () => {' + await code('extension/ui/library.js') + '\n})()', ctx);
  const buttons = list => [...document.querySelectorAll(list + ' button')];
  assert.equal(document.querySelector('#active-scripts img'), null, 'Script names are rendered as text');
  buttons('#active-scripts')[0].click(); await tick();
  assert.equal(document.querySelector('#active-count').textContent, '1개');
  assert.equal(calls.filter(call => call.type === 'scripts:archive').length, 0);
  approveArchive = true;
  buttons('#active-scripts')[0].click(); await tick();
  assert.equal(document.querySelector('#active-count').textContent, '0개');
  buttons('#archived-scripts')[0].click(); await tick();
  assert.equal(document.querySelector('#active-count').textContent, '1개');
  buttons('#active-scripts')[0].click(); await tick();
  buttons('#archived-scripts')[1].click();
  assert.equal(dialog.open, true); assert.equal(calls.filter(call => call.type === 'scripts:delete').length, 0);
  document.querySelector('#cancel-delete').click(); assert.equal(dialog.open, false);
  buttons('#archived-scripts')[1].click(); fail = true;
  document.querySelector('#confirm-delete').click(); await tick();
  assert.equal(dialog.open, true); assert.match(document.querySelector('#library-status').textContent, /저장 실패/);
  assert.equal(buttons('#archived-scripts')[0].disabled, false);
  fail = false; document.querySelector('#confirm-delete').click(); await tick();
  assert.equal(dialog.open, false); assert.equal(document.querySelector('#archived-count').textContent, '0개');
  assert.deepEqual(state.deleted, ['task']);
});

test('script site scope rejects lookalike hosts and supports wildcard subdomains', () => {
  assert.equal(matchesSite('https://*.example.test/form*', 'https://example.test/form'), true);
  assert.equal(matchesSite('https://*.example.test/form*', 'https://sub.example.test/form?x=1'), true);
  assert.equal(matchesSite('https://*.example.test/*', 'https://example.test.attacker.test/form'), false);
  assert.equal(matchesSite('https://example.test/*', 'http://example.test/form'), false);
});

test('explicit ON provides creation on empty/deleted sites; OFF blocks stale controls until an active run completes', async () => {
  const { ctx, window, document } = context();
  window.MacroStudio = { features: {} };
  await load(ctx, 'extension/ui/launcher.js');
  const app = window.MacroStudio.launcher.create(), host = document.getElementById('macro-studio-launcher'), shadow = host.shadowRoot;
  const state = { ready: true, siteEnabled: true, archived: [], deleted: [] };
  app.applyLibraryState(state);
  assert.equal(host.hidden, false, 'ON shows an entry point even without a script');
  shadow.querySelector('.orb').click();
  assert.equal(shadow.querySelector('.studio-open').disabled, false);
  app.applyLibraryState({ ...state, deleted: ['task'] });
  assert.equal(host.hidden, false, 'Deleting every script does not disable explicit ON');
  let runs = 0, finish;
  app.register({ id: 'task', name: '작업', run: () => { runs++; return new Promise(resolve => { finish = resolve; }); } });
  app.applyLibraryState(state);
  const stale = shadow.querySelector('.script'); stale.click();
  const form = shadow.querySelector('form'); form.reportValidity = () => true;
  app.applyLibraryState({ ...state, siteEnabled: false });
  assert.equal(host.hidden, true); assert.equal(shadow.querySelector('.panel').hidden, true);
  stale.click(); form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.equal(runs, 0);
  app.applyLibraryState(state);
  shadow.querySelector('.script').click(); form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.equal(runs, 1);
  app.applyLibraryState({ ...state, siteEnabled: false });
  assert.equal(host.hidden, false, 'Let an already running job finish');
  assert.equal(shadow.querySelector('.studio-open').disabled, true);
  finish(); await tick();
  assert.equal(host.hidden, true);
});
