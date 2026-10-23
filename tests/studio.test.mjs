import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { context, code, tick } from './helpers.mjs';
import { agentPrompt, exportRecording, MAX_STEPS, normalizeEvent } from '../extension/recorder/model.js';
import { sitePattern } from '../extension/recorder/frames.js';

async function studio({ enabled = false, sites = [], initialRecording = null } = {}) {
  let active = { id: 42, url: 'https://example.test/form' }, recording = structuredClone(initialRecording), approve = true, gesture = false, poll, activated, clipboardFailure = false;
  const permissionCalls = [], messages = [], copied = [];
  let frameResult = null;
  const chrome = {
    runtime: { sendMessage: async message => {
      messages.push(message);
      if (message.type === 'studio:state') return { ok: true, value: recording };
      if (message.type === 'local:status') return { ok: true, value: { connected: false, count: 0 } };
      if (message.type === 'frames:scan') return frameResult || { ok: true, value: {
        tabId: message.tabId, origin: message.tabId === 42 ? 'https://example.test' : 'https://other.test',
        pattern: message.tabId === 42 ? 'https://example.test/*' : 'https://other.test/*', topAllowed: true,
        detectionEnabled: enabled, frames: enabled ? structuredClone(sites) : []
      } };
      if (message.type === 'studio:activate') return { ok: true, value: { connected: 1, failed: 0 } };
      if (message.type === 'recording:start') {
        recording = { id: 'recording-1', tabId: message.tabId, name: 'test', status: 'recording', steps: [], origins: [] };
        return { ok: true, value: recording };
      }
      if (message.type === 'recording:stop') { recording.status = 'stopped'; return { ok: true, value: recording }; }
      if (message.type === 'recording:edit' && message.remove) {
        recording.steps = recording.steps.filter(step => step.id !== message.id);
        return { ok: true, value: recording };
      }
      throw new Error('Unexpected request: ' + message.type);
    } },
    permissions: {
      request: async query => {
        assert.equal(gesture, true, 'Permission requests must run directly in the actual click handler');
        permissionCalls.push(structuredClone(query));
        if (!approve) return false;
        if (query.permissions?.includes('webNavigation')) enabled = true;
        if (frameResult?.value && query.origins?.includes(frameResult.value.pattern)) frameResult.value.topAllowed = true;
        for (const site of sites) if (query.origins?.includes(site.pattern)) site.allowed = true;
        return true;
      }, onAdded: { addListener() {} }, onRemoved: { addListener() {} }
    },
    tabs: { query: async () => [active], onActivated: { addListener: callback => { activated = callback; } }, onUpdated: { addListener() {} } },
    storage: { onChanged: { addListener() {} } }
  };
  const navigator = { clipboard: { writeText: async value => { if (clipboardFailure) throw new Error('Clipboard unavailable'); copied.push(value); } } };
  const env = context(await code('extension/ui/studio.html'), { chrome, navigator, URL, agentPrompt, exportRecording, MAX_STEPS, sitePattern,
    setInterval: callback => { poll = callback; return 1; } });
  await vm.runInContext('(async () => {' + (await code('extension/ui/studio.js')).replace(/^import[^\n]+\n/gm, '') + '\n})()', env.ctx);
  return { ...env, sites, permissionCalls, messages, copied,
    setFrameResult: value => { frameResult = value; },
    setApproval: value => { approve = value; },
    failClipboard: () => { clipboardFailure = true; },
    click: async selector => { gesture = true; env.document.querySelector(selector).click(); gesture = false; await tick(); },
    poll: async () => { poll(); await tick(); },
    activate: async tab => { active = tab; await activated(); await tick(); }
  };
}

test('sidebar discovers frames without manual addresses and requests only selected missing permissions on a click', async () => {
  const env = await studio({ sites: [
    { origin: 'https://known.test', pattern: 'https://known.test/*', frameIds: [1], allowed: true },
    { origin: 'https://new.test', pattern: 'https://new.test/*', frameIds: [2], allowed: false }
  ] });
  assert.equal(env.document.querySelector('#frame-sites').tagName, 'UL');
  assert.equal(env.permissionCalls.length, 0);
  await env.click('#allow');
  assert.deepEqual(env.permissionCalls[0], { origins: [], permissions: ['webNavigation'] });
  assert.match(env.document.querySelector('#frame-status').textContent, /1곳/);
  assert.equal(env.document.querySelectorAll('#frame-sites input').length, 1);
  assert.equal(env.document.querySelector('#allow-frames').disabled, true);
  const checkbox = env.document.querySelector('#frame-sites input');
  checkbox.checked = true; checkbox.dispatchEvent(new env.window.Event('change'));
  env.setApproval(false); await env.click('#allow-frames');
  assert.match(env.document.querySelector('#status').textContent, /허용되지 않았습니다/);
  assert.equal(env.sites[1].allowed, false);
  env.setApproval(true); await env.click('#allow-frames');
  assert.deepEqual(env.permissionCalls.at(-1), { origins: ['https://new.test/*'] });
  assert.equal(env.document.querySelector('#allow-frames').hidden, true);
  assert.equal(env.document.querySelectorAll('#frame-sites input').length, 0);
  const count = env.permissionCalls.length;
  await env.poll(); await env.click('#allow');
  assert.equal(env.permissionCalls.length, count, 'Existing grants do not cause repeated permission requests');
});

test('changing to an unreadable site clears old grants and uses the recovered origin for a scoped permission request', async () => {
  const env = await studio({ enabled: true, sites: [
    { origin: 'https://child.test', pattern: 'https://child.test/*', frameIds: [2], allowed: false }
  ] });
  assert.equal(env.document.querySelector('#start').disabled, false);
  env.setFrameResult({ ok: false, error: '현재 탭의 주소를 확인할 수 없습니다. 도구모음에서 다시 열어주세요.' });
  await env.activate({ id: 99 });
  assert.equal(env.document.querySelector('#start').disabled, true);
  assert.equal(env.document.querySelector('#frame-sites').children.length, 0);
  assert.equal(env.document.querySelector('#allow-frames').hidden, true);
  await env.click('#allow');
  assert.equal(env.permissionCalls.length, 0, 'A missing URL must not reuse the previous site grant');
  env.setFrameResult({ ok: true, value: {
    tabId: 99, origin: 'https://when2jam.pages.dev', pattern: 'https://when2jam.pages.dev/*',
    topAllowed: false, detectionEnabled: true, frames: []
  } });
  await env.poll();
  assert.equal(env.document.querySelector('#site').textContent, 'https://when2jam.pages.dev');
  assert.equal(env.document.querySelector('#frame-status').dataset.error, 'false');
  assert.equal(env.document.querySelector('#start').disabled, true);
  await env.click('#allow');
  assert.deepEqual(env.permissionCalls, [{ origins: ['https://when2jam.pages.dev/*'], permissions: [] }]);
  assert.equal(env.document.querySelector('#start').disabled, false);
  assert.equal(env.messages.filter(message => message.type === 'studio:activate').at(-1).origin, 'https://when2jam.pages.dev');
});

test('new frames during recording are suggested without a popup and stay bound to the recording tab', async () => {
  const env = await studio({ enabled: true });
  await env.click('#start');
  await env.activate({ id: 99, url: 'https://other.test/page' });
  env.sites.push({ origin: 'https://later.test', pattern: 'https://later.test/*', frameIds: [7], allowed: false });
  await env.poll();
  assert.equal(env.messages.filter(message => message.type === 'frames:scan').at(-1).tabId, 42);
  assert.equal(env.permissionCalls.length, 0, 'Discovery alone never requests host access');
  const checkbox = env.document.querySelector('#frame-sites input'); checkbox.checked = true;
  checkbox.dispatchEvent(new env.window.Event('change')); await env.click('#allow-frames');
  assert.equal(env.messages.filter(message => message.type === 'studio:activate').at(-1).tabId, 42);
  assert.equal(env.messages.filter(message => message.type === 'recording:start').length, 1);
  assert.equal(env.document.querySelector('#stop').disabled, false);
  assert.match(env.document.querySelector('#site').textContent, /example\.test/);
});

test('step deletion preserves remaining recording metadata and the visible preview copies with changing-value instructions', async () => {
  const env = await studio({ enabled: true, initialRecording: {
    name: '기록 테스트', status: 'stopped', tabId: 42, createdAt: 'now', steps: [
      { id: 'date', ...normalizeEvent({ action: 'input', page: { url: 'https://example.test/form' }, target: { label: '출장일' }, value: '2026-10-24' }) },
      { id: 'submit', ...normalizeEvent({ action: 'click', page: { url: 'https://example.test/form' }, target: { label: '최종 결재상신' } }) }
    ]
  } });
  const preview = env.document.querySelector('#preview'), variables = env.document.querySelector('#variables');
  assert.equal(env.document.querySelectorAll('#steps select, #steps input').length, 0);
  assert.equal(preview.closest('details'), null);
  assert.equal(env.document.querySelector('#goal').getAttribute('placeholder').includes('결재선 목록 선택'), true);
  assert.equal(variables.getAttribute('placeholder'), '출장일, 출장 시간');
  variables.value = '출장일, 출장 시간'; variables.dispatchEvent(new env.window.Event('input'));
  await env.click('#prompt');
  assert.equal(env.copied[0], preview.value);
  assert.match(env.copied[0], /변경할 값: 출장일, 출장 시간/);
  assert.match(env.copied[0], /mode=fixed여도 실행할 때 입력받도록/);
  await env.click('#steps .step-delete');
  assert.equal(env.document.querySelector('#count').textContent, '1단계');
  const data = JSON.parse(preview.value.split('<recording-data>\n')[1].split('\n</recording-data>')[0]);
  assert.equal(data.steps[0].id, 'submit');
  assert.equal(data.steps[0].mode, 'manual');
  assert.deepEqual(structuredClone(env.messages.filter(message => message.type === 'recording:edit')), [{ type: 'recording:edit', id: 'date', remove: true }]);
  let selected = false; preview.select = () => { selected = true; };
  env.failClipboard(); await env.click('#prompt');
  assert.equal(selected, true, 'Clipboard failures select the visible preview without relying on a removed toggle');
  assert.match(env.document.querySelector('#status').textContent, /직접 복사/);
});
