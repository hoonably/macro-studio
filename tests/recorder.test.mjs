import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent, safeURL, agentPrompt, exportRecording, DEFAULT_STOP_BEFORE } from '../extension/recorder/model.js';
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
  assert.equal(normalizeEvent({ ...input, modeSource: 'user' }).modeSource, 'automatic', 'Page events cannot claim that a mode was chosen by the user');
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
  const prompt = agentPrompt(record, { variables: '출장일, 출장 시간' });
  assert.match(prompt, /변경할 값: 출장일, 출장 시간/);
  assert.match(prompt, /mode=fixed여도 실행할 때 입력받도록/);
  assert.match(prompt, /나머지 기록값은 기본값/);
  assert.equal(record.steps[0].value, '2026-10-23', 'Generating a prompt preserves recorded example values');
  assert.ok(!JSON.stringify(exported).includes('token=private'));
});
test('prompt distinguishes inferred and legacy manual hints from user instructions without permitting final submission', () => {
  const inferred = normalizeEvent({ ...input, action: 'click', target: { label: '신규 결재상신' } });
  const { modeSource, ...legacy } = inferred;
  const user = { ...inferred, modeSource: 'user', target: { ...inferred.target, label: '직접 확인' } };
  const final = normalizeEvent({ ...input, action: 'click', target: { label: '최종 결재상신' } });
  const record = { name: '출장 신청', stopBefore: '최종 제출·결재상신은 사용자가 직접 실행', steps: [inferred, legacy, user, final] };
  const exported = exportRecording(record);
  assert.equal(modeSource, 'automatic');
  assert.equal(inferred.mode, 'manual', 'A potentially consequential label remains a review hint');
  assert.deepEqual(exported.steps.map(step => step.modeSource), ['automatic', 'legacy', 'user', 'automatic']);
  assert.equal(exported.steps[2].mode, 'manual');
  assert.equal(exported.steps[3].mode, 'manual');
  assert.equal(exported.stopBefore, DEFAULT_STOP_BEFORE);
  assert.equal(exportRecording({ ...record, stopBefore: '입력 완료 직후 멈춤' }).stopBefore, '입력 완료 직후 멈춤');
  assert.equal('modeSource' in legacy, false, 'Export does not rewrite the original recording');
  const prompt = agentPrompt(record, { goal: '신규 결재상신 → 확인 → 결재선 선택까지' });
  assert.match(prompt, /modeSource=automatic은 버튼 문구에 따른 참고 분류/);
  assert.match(prompt, /modeSource=legacy는 분류 출처가 없는 과거 기록/);
  assert.match(prompt, /modeSource=user의 mode=manual 및 사용자가 직접 명시한 수동 단계는 실행하지 마/);
  assert.match(prompt, /docs\/unist\.md/);
  assert.match(prompt, /실제 최종 제출·최종 결재상신은 자동 실행하지 마/);
  assert.doesNotMatch(prompt, /mode=manual 단계 및 최종 제출은 자동 실행하지 마/);
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
  listeners[0]({ type: 'capture:state', recordingId: 'recording-1' }, {}, () => {});
  await tick();
  assert.equal(messages.filter(message => message.event?.action === 'navigation').length, 1, 'Reconnecting the same recording does not duplicate navigation');
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
