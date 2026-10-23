import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { context, code, tick } from './helpers.mjs';
import { optionalResetPermissions } from '../extension/core/reset.js';

test('reset page stays read-only until the user acknowledges the scope and confirms', async () => {
  const messages = [];
  const env = context(await code('extension/ui/reset.html'), { chrome: { runtime: { sendMessage: async message => {
    messages.push(message);
    return { ok: true, value: message.type === 'reset:state' ? { steps: 7, scripts: 2, sites: 3, connected: true, recording: true, running: false } : { reset: true } };
  } } } });
  await vm.runInContext('(async()=>{' + await code('extension/ui/reset.js') + '})()', env.ctx);
  assert.deepEqual(messages.map(item => item.type), ['reset:state']);
  const button = env.document.getElementById('confirm-reset'), check = env.document.getElementById('reset-ack');
  button.click(); await tick(); assert.equal(messages.length, 1);
  check.checked = true; check.dispatchEvent(new env.window.Event('change'));
  assert.equal(button.disabled, false); button.click(); await tick();
  assert.equal(messages[1].type, 'reset:confirm'); assert.equal(messages[1].confirmed, true);
  assert.equal(button.disabled, true); assert.match(env.document.getElementById('reset-result').textContent, /초기화했습니다/);
});

test('permission cleanup preserves required content hosts, API permissions and unrelated grants', () => {
  const plan = optionalResetPermissions({ host_permissions: ['https://required.test/*'], permissions: ['storage', 'userScripts'],
    optional_permissions: ['webNavigation'], content_scripts: [{ matches: ['https://*.frames.test/sap/*'] }] },
  { origins: ['https://required.test/*', 'https://child.frames.test/*', 'https://optional.test/*', 'file:///*'], permissions: ['storage', 'userScripts', 'webNavigation', 'unrelated'] });
  assert.deepEqual(plan, { origins: ['https://optional.test/*'], permissions: ['webNavigation'] });
});

test('a folder picker opened before reset cannot restore its stale directory handle', async () => {
  let values = new Map();
  const db = { close() {}, transaction() {
    const draft = new Map(values), transaction = { aborted: false, abort() { this.aborted = true; queueMicrotask(() => this.onabort?.()); }, objectStore() {
      return { get(key) { const request = {}; queueMicrotask(() => { request.result = draft.get(key); request.onsuccess?.(); }); return request; },
        put(value, key) { draft.set(key, value); }, delete(key) { draft.delete(key); }, clear() { draft.clear(); } };
    } };
    setTimeout(() => { if (!transaction.aborted) { values = draft; transaction.oncomplete?.(); } }, 0);
    return transaction;
  } };
  const indexedDB = { open() { const request = {}; queueMicrotask(() => { request.result = db; request.onsuccess(); }); return request; } };
  const ctx = vm.createContext({ indexedDB, crypto: webcrypto });
  const store = vm.runInContext((await code('extension/scripts/store.js')).replaceAll('export ', '') + '\n({readLocal,writeLocal,resetLocal})', ctx);
  const oldEpoch = await store.readLocal('resetEpoch');
  await store.writeLocal({ folder: 'old folder', snapshot: 'private code' });
  await store.resetLocal();
  await assert.rejects(store.writeLocal({ folder: 'late picker' }, oldEpoch), /초기화되었습니다/);
  assert.equal(await store.readLocal('folder'), undefined); assert.equal(await store.readLocal('snapshot'), undefined);
  await store.writeLocal({ folder: 'new deliberate choice' }, await store.readLocal('resetEpoch'));
  assert.equal(await store.readLocal('folder'), 'new deliberate choice');
});
