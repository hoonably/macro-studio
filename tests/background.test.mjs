import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { MAX_STEPS, normalizeEvent } from '../extension/recorder/model.js';
import { code } from './helpers.mjs';
async function worker() {
  const state = {}, calls = [], origins = ['https://example.test/*'];
  let listener;
  const removed = [];
  const event = () => ({ addListener() {} });
  const chrome = {
    runtime: { id: 'studio', getURL: file => 'chrome-extension://studio/' + file,
      onMessage: { addListener: value => { listener = value; } }, onInstalled: event(), onStartup: event() },
    storage: { session: { get: async key => ({ [key]: structuredClone(state[key]) }),
      set: async value => Object.assign(state, structuredClone(value)), remove: async key => { delete state[key]; } } },
    permissions: { getAll: async () => ({ origins }), contains: async query => query.origins.every(item => origins.includes(item)), onAdded: event(), onRemoved: { addListener: value => removed.push(value) } },
    scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async value => calls.push(['register', value]),
      executeScript: async value => calls.push(['inject', value]) },
    tabs: { get: async id => ({ id, url: 'https://example.test/form' }), sendMessage: async (...args) => calls.push(['send', args]), onRemoved: event() },
    sidePanel: { open: async value => calls.push(['open', value]), setPanelBehavior: async () => {} }
  };
  const source = (await code('extension/background.js')).replace(/^import[^\n]+\n/, '');
  vm.runInNewContext(source, { chrome, MAX_STEPS, normalizeEvent, crypto: webcrypto, URL, console, Date });
  const ui = { id: 'studio', url: 'chrome-extension://studio/ui/studio.html' };
  const content = { id: 'studio', url: 'https://example.test/form?token=private', frameId: 0, tab: { id: 42 } };
  const send = (message, sender = ui) => new Promise(resolve => listener(message, sender, resolve));
  return { state, calls, send, ui, content, removed };
}
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
  await send({ type: 'recording:stop' });
  const id = state.macroStudioRecording.steps[0].id;
  assert.ok((await send({ type: 'recording:edit', id, mode: 'variable', variable: 'date' })).ok);
  assert.equal(state.macroStudioRecording.steps[0].value, '');
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
