import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { context, code, tick } from './helpers.mjs';
import { UPDATE_PREFERENCES_KEY, AVAILABLE_UPDATE_KEY, notificationsEnabled, availableVersion, updateMessage } from '../extension/core/update-notices.js';

async function screen({ store = true, preferences, available, response = { status: 'no_update' } } = {}) {
  const env = context('<html><head></head><body><header></header><main></main><footer></footer></body></html>');
  const local = { [UPDATE_PREFERENCES_KEY]: preferences, [AVAILABLE_UPDATE_KEY]: available };
  const calls = []; let change, interval;
  env.window.location = { hash: '' };
  env.window.HTMLElement.prototype.showModal = function() { this.open = true; };
  env.window.HTMLElement.prototype.close = function() { this.open = false; };
  const chrome = {
    runtime: { getManifest: () => ({ version: '1.3.0' }),
      requestUpdateCheck: async () => { calls.push('store-check'); if (response instanceof Error) throw response; return response; },
      sendMessage: async () => { calls.push('local-check'); return { ok: true, value: response }; } },
    storage: { local: {
      get: async key => ({ [key]: local[key] }),
      set: async values => { Object.assign(local, values); },
      remove: async key => { delete local[key]; }
    }, onChanged: { addListener: listener => { change = listener; } } }
  };
  Object.assign(env.ctx, { chrome, STORE_BUILD: store, UPDATE_PREFERENCES_KEY, AVAILABLE_UPDATE_KEY, notificationsEnabled, availableVersion, updateMessage,
    setInterval: callback => { interval = callback; } });
  await vm.runInContext('(async () => {' + (await code('extension/ui/update.js')).replace(/^import[^\n]+\n/gm, '') + '\n})()', env.ctx);
  return { ...env, calls, local, change, poll: async () => { interval?.(); await tick(); },
    click: async selector => { env.document.querySelector(selector).click(); await tick(); } };
}

test('store notices use Chrome events without polling the network, and notification preferences persist', async () => {
  const env = await screen({ available: { version: '1.4.0' } });
  const notice = env.document.querySelector('.update-notice');
  assert.equal(notice.hidden, false); assert.match(notice.textContent, /1\.4\.0/);
  assert.deepEqual(env.calls, [], 'Opening an extension page must not trigger a remote update check');
  await env.click('.update-entry'); assert.equal(env.document.querySelector('dialog').open, true);
  const checkbox = env.document.querySelector('#update-notifications'); checkbox.checked = false;
  checkbox.dispatchEvent(new env.window.Event('change')); await tick();
  assert.equal(env.local[UPDATE_PREFERENCES_KEY].notify, false); assert.equal(notice.hidden, true);
  const reopened = await screen({ preferences: env.local[UPDATE_PREFERENCES_KEY], available: { version: '1.4.0' } });
  assert.equal(reopened.document.querySelector('#update-notifications').checked, false);
  assert.equal(reopened.document.querySelector('.update-notice').hidden, true);
  await reopened.click('.update-check');
  assert.deepEqual(reopened.calls, ['store-check'], 'A manual check still works when alerts are disabled');
  assert.match(reopened.document.querySelector('#update-result').textContent, /새 버전이 없습니다/);
});

test('rate limits and failed checks are not reported as up to date', async () => {
  for (const [response, expected] of [[{ status: 'throttled' }, /잠시 후/], [new Error('오프라인입니다.'), /오프라인/]]) {
    const env = await screen({ response }); await env.click('.update-check');
    const result = env.document.querySelector('#update-result');
    assert.match(result.textContent, expected); assert.doesNotMatch(result.textContent, /새 버전이 없습니다/);
    assert.equal(env.document.querySelector('.update-check').disabled, false);
  }
});

test('turning off local notices does not disable safe build detection', async () => {
  const env = await screen({ store: false, preferences: { notify: false }, response: { pending: true } });
  assert.equal(env.document.querySelector('.update-notice').hidden, true);
  await env.poll(); assert.deepEqual(env.calls, ['local-check', 'local-check']);
  await env.click('.update-check');
  assert.match(env.document.querySelector('#update-result').textContent, /기록이나 작업이 끝나면/);
  const unavailable = await screen({ store: false, response: { unavailable: true } });
  await unavailable.click('.update-check');
  assert.equal(unavailable.document.querySelector('#update-result').dataset.error, 'true');
});

test('a store notification for the installed version or malformed version stays hidden', async () => {
  for (const version of ['1.3.0', '<script>bad</script>', '']) {
    const env = await screen({ available: { version } });
    assert.equal(env.document.querySelector('.update-notice').hidden, true);
  }
});
