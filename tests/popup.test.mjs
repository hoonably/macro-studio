import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { context, code, tick } from './helpers.mjs';
import { siteSettings } from '../extension/core/site-settings.js';

async function popup({ enabled = false, allowed = false, error = '' } = {}) {
  const messages = [], grants = [];
  let approve = true, gesture = false, writeError = '';
  const state = { tabId: 42, origin: 'https://when2jam.pages.dev', pattern: 'https://when2jam.pages.dev/*', enabled, allowed };
  const chrome = {
    tabs: { query: async () => [{ id: 42 }] },
    permissions: { request: async request => {
      assert.equal(gesture, true, 'No async calls precede the permission request');
      grants.push(structuredClone(request));
      if (approve) state.allowed = true;
      return approve;
    } },
    runtime: { sendMessage: async message => {
      messages.push(structuredClone(message));
      if (error) return { ok: false, error };
      if (message.type === 'site:set') {
        if (writeError) return { ok: false, error: writeError };
        state.enabled = message.enabled;
      }
      return { ok: true, value: structuredClone(state) };
    } }
  };
  const env = context(await code('extension/ui/popup.html'), { chrome, URL });
  await vm.runInContext('(async () => {' + await code('extension/ui/popup.js') + '\n})()', env.ctx);
  return { ...env, messages, grants, state, setApproval: value => { approve = value; }, failWrite: value => { writeError = value; },
    click: async () => { gesture = true; env.document.querySelector('#site-toggle').click(); gesture = false; await tick(); } };
}

test('popup only grants the current site on ON, remembers state, and never opens the studio', async () => {
  const env = await popup(), toggle = env.document.getElementById('site-toggle');
  assert.equal(env.document.getElementById('site').textContent, 'when2jam.pages.dev');
  assert.equal(env.grants.length, 0);
  assert.equal(toggle.getAttribute('aria-checked'), 'false');
  await env.click();
  assert.deepEqual(env.grants, [{ origins: ['https://when2jam.pages.dev/*'] }]);
  assert.equal(toggle.getAttribute('aria-checked'), 'true');
  assert.match(env.document.getElementById('status').textContent, /파란 버튼 → 새 자동화 만들기/);
  await env.click();
  assert.equal(toggle.getAttribute('aria-checked'), 'false');
  await env.click();
  assert.equal(env.grants.length, 1, 'Re-enabling uses the existing permission');
  assert.equal(env.messages.some(message => message.type === 'studio:open'), false);
});

test('permission denial and navigation/write errors keep the popup state unchanged and retryable', async () => {
  const env = await popup(), toggle = env.document.getElementById('site-toggle');
  env.setApproval(false); await env.click();
  assert.equal(env.messages.filter(message => message.type === 'site:set').length, 0);
  assert.equal(toggle.getAttribute('aria-checked'), 'false'); assert.equal(toggle.disabled, false);
  env.setApproval(true); env.failWrite('페이지 주소가 바뀌었습니다. 팝업을 다시 열어주세요.'); await env.click();
  assert.equal(toggle.getAttribute('aria-checked'), 'false');
  assert.match(env.document.getElementById('status').textContent, /주소가 바뀌었습니다/);
  assert.equal(toggle.disabled, false);
});

test('unsupported pages disable the switch and settings retain origins only', async () => {
  const env = await popup({ error: '일반 웹사이트에서 사용하세요.' });
  assert.equal(env.document.getElementById('site-toggle').disabled, true);
  assert.match(env.document.getElementById('status').textContent, /일반 웹사이트/);
  assert.deepEqual(siteSettings({ 'https://example.test': true, 'http://localhost:3000': false,
    'https://example.test/path?secret': true, 'chrome://extensions': true, 'https://other.test': 'false' }),
    { 'https://example.test': true, 'http://localhost:3000': false });
});
