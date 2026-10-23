import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { context, code, tick } from './helpers.mjs';

async function screen(enabled = true) {
  let folder = null, granted = true, gesture = false, poll, permission = 'granted';
  const calls = [], selected = { name: 'scripts', requestPermission: async options => { assert.equal(gesture, true); calls.push(['read', structuredClone(options)]); permission = 'granted'; return permission; } };
  const recording = { status: 'stopped', steps: [] };
  const state = { enabled, count: enabled ? 1 : 0, scripts: [{ id: 'task', name: '<img src=x> 이름', matches: ['https://new.test/*'] }], missingOrigins: ['https://new.test/*'] };
  const env = context(await code('extension/ui/scripts.html'));
  env.window.showDirectoryPicker = async options => { assert.equal(gesture, true, 'Picker must run directly from the click'); calls.push(['picker', structuredClone(options)]); return selected; };
  const readLocal = async () => folder;
  const writeLocal = async values => { folder = values.folder; };
  const chrome = { runtime: { id: 'studio', reload: () => calls.push(['reload']), sendMessage: async message => { calls.push(['message', message.type]); return { ok: true, value: message.type === 'studio:state' ? recording : { ...state, connected: !!folder, readable: permission === 'granted', folderName: folder?.name || '' } }; } },
    storage: { local: { set: async value => calls.push(['store', structuredClone(value)]) } },
    tabs: { create: async value => calls.push(['tab', value]), getCurrent: async () => ({ id: 42 }) }, permissions: { request: async options => { assert.equal(gesture, true); calls.push(['sites', options]); if (granted) state.missingOrigins = []; return granted; } } };
  Object.assign(env.ctx, { chrome, readLocal, writeLocal, scriptsDirectory: async handle => handle, setInterval: callback => { poll = callback; } });
  await vm.runInContext('(async () => {' + (await code('extension/ui/scripts.js')).replace(/^import[^\n]+\n/gm, '') + '\n})()', env.ctx);
  return { ...env, calls, state, recording, click: async selector => { gesture = true; env.document.querySelector(selector).click(); gesture = false; await tick(); },
    poll: async () => { poll(); await tick(); }, deny: () => { granted = false; }, allow: () => { granted = true; }, revokeRead: () => { permission = 'prompt'; } };
}

test('folder setup and site permission requests use actual gestures; polling and reconnecting do not request access', async () => {
  const env = await screen();
  assert.equal(env.document.querySelector('#synced-scripts img'), null);
  await env.poll(); assert.equal(env.calls.filter(call => ['picker', 'sites', 'read'].includes(call[0])).length, 0);
  await env.click('#connect-folder');
  assert.deepEqual(env.calls.find(call => call[0] === 'picker')[1], { id: 'macro-studio-scripts', mode: 'read' });
  assert.match(env.document.querySelector('#script-state').textContent, /scripts/);
  const checkbox = env.document.querySelector('#script-origins input');
  assert.equal(checkbox.checked, false); checkbox.checked = true; checkbox.dispatchEvent(new env.window.Event('change'));
  env.deny(); await env.click('#grant-script-origins');
  assert.match(env.document.querySelector('#script-state').textContent, /허용되지/);
  env.allow(); await env.click('#grant-script-origins');
  assert.equal(env.document.querySelector('#script-origins-section').hidden, true);
  const count = env.calls.filter(call => call[0] === 'sites').length;
  await env.poll(); assert.equal(env.calls.filter(call => call[0] === 'sites').length, count);
  env.revokeRead(); await env.poll();
  assert.equal(env.document.querySelector('#grant-folder').hidden, false);
  await env.click('#grant-folder'); assert.equal(env.document.querySelector('#grant-folder').hidden, true);
  assert.deepEqual(env.calls.find(call => call[0] === 'read')[1], { mode: 'read' });
  await env.click('#disconnect-folder');
  assert.match(env.document.querySelector('#script-state').textContent, /마지막으로 가져온 1개/);
});

test('first setup starts with folder selection, and applying updates protects current recordings and tasks', async () => {
  const env = await screen(false);
  assert.equal(env.document.querySelector('#connect-folder').disabled, false);
  assert.equal(env.document.querySelector('#script-permission-setup').hidden, true);
  await env.click('#connect-folder');
  assert.equal(env.document.querySelector('#script-permission-setup').hidden, false);
  assert.match(env.document.querySelector('#script-state').textContent, /폴더는 연결/);
  env.recording.steps.push({ type: 'click' });
  await env.click('#apply-script-settings');
  assert.equal(env.calls.some(call => call[0] === 'reload'), false);
  assert.match(env.document.querySelector('#script-state').textContent, /기록을 복사·저장/);
  env.recording.steps = []; env.state.running = true;
  await env.click('#reload-extension');
  assert.equal(env.calls.some(call => call[0] === 'reload'), false);
  env.state.running = false; env.recording.status = 'recording';
  await env.click('#reload-extension');
  assert.equal(env.calls.some(call => call[0] === 'reload'), false);
  env.recording.status = 'stopped';
  await env.click('#apply-script-settings');
  assert.deepEqual(env.calls.find(call => call[0] === 'store')[1], { macroStudioResumeScriptsTab: 42 });
  assert.equal(env.calls.filter(call => call[0] === 'reload').length, 1);
  assert.equal(env.calls.filter(call => ['sites', 'read'].includes(call[0])).length, 0);
});
