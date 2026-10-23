import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent, safeURL, agentPrompt, exportRecording } from '../extension/recorder/model.js';
import { context, load, trusted, tick } from './helpers.mjs';

const input = { action: 'input', page: { url: 'https://example.test/form?token=private#secret', title: 'Example' },
  target: { tag: 'input', type: 'text', name: 'visitDate', label: '방문일', selectors: ['[name="visitDate"]'] }, value: '2026-10-23' };
test('recording removes URL secrets, rejects sensitive fields and marks final actions manual', () => {
  const step = normalizeEvent(input, { frameId: 3 });
  assert.equal(step.page.url, 'https://example.test/form');
  assert.equal(step.frameId, 3);
  for (const target of [{ type: 'password' }, { type: 'hidden' }, { name: 'api_token' }, { autocomplete: 'one-time-code' }, { autocomplete: 'cc-number' }]) {
    assert.equal(normalizeEvent({ ...input, target }), null);
  }
  assert.equal(normalizeEvent({ ...input, value: 'Bearer not-a-real-secret' }).value, '[redacted]');
  assert.equal(normalizeEvent({ ...input, action: 'click', target: { label: '최종 결재상신' } }).mode, 'manual');
  assert.equal(safeURL('chrome://extensions'), '');
  assert.ok(!safeURL('https://example.test/' + 'x'.repeat(100)).includes('x'.repeat(100)));
});
test('export leaves browser tab details behind and prompt distinguishes observed data from instructions', () => {
  const record = { name: '테스트', tabId: 999, origins: ['https://example.test/*'], createdAt: 'now', steps: [normalizeEvent(input)] };
  const exported = exportRecording(record);
  assert.equal(exported.tabId, undefined);
  assert.equal(exported.origins, undefined);
  assert.match(agentPrompt(record), /AGENTS\.md/);
  assert.match(agentPrompt(record), /관찰 자료/);
  assert.match(agentPrompt(record), /최종 제출/);
  assert.ok(!JSON.stringify(exported).includes('token=private'));
});
test('capture reconnects using response envelope, ignores password and untrusted events, flushes pending input', async () => {
  const messages = [], listeners = [];
  const chrome = { runtime: {
    onMessage: { addListener: listener => listeners.push(listener) },
    sendMessage: async message => {
      messages.push(message);
      return message.type === 'capture:status' ? { ok: true, value: { recordingId: 'recording-1' } } : { ok: true };
    }
  } };
  const { window, document, ctx } = context('<html><body><input name="visitDate"><input type="password" name="password"><button type="button">열기</button></body></html>', { chrome });
  await load(ctx, 'extension/recorder/capture.js'); await tick();
  assert.equal(messages.filter(message => message.type === 'capture:event')[0].event.action, 'navigation');
  const field = document.querySelector('[name="visitDate"]'); field.value = '2026-10-23';
  field.dispatchEvent(new window.Event('input', { bubbles: true })); await tick();
  assert.equal(messages.filter(message => message.event?.action === 'input').length, 0);
  const password = document.querySelector('[type="password"]'); password.value = 'DO_NOT_RECORD'; trusted(window, password, 'input');
  trusted(window, field, 'input');
  await new Promise(resolve => listeners[0]({ type: 'capture:flush' }, {}, resolve));
  const captured = messages.filter(message => message.event?.action === 'input');
  assert.equal(captured.length, 1); assert.equal(captured[0].event.value, '2026-10-23');
  assert.ok(!JSON.stringify(messages).includes('DO_NOT_RECORD'));
  let acknowledged = false;
  listeners[0]({ type: 'capture:state', recordingId: null }, {}, () => { acknowledged = true; });
  assert.ok(acknowledged);
  trusted(window, document.querySelector('button'), 'click'); await tick();
  assert.equal(messages.filter(message => message.event?.action === 'click').length, 0);
});
