import test from 'node:test';
import assert from 'node:assert/strict';
import { context, load, tick } from './helpers.mjs';

const configuration = { destination: '방문 지역', organization: '방문 기관', purpose: '업무 미팅', memo: '검토용 메모',
  approvalLine: '[출장] 예제 결재선', approvers: ['검토자A', '승인자B'] };
const files = ['extension/core/namespace.js', 'extension/adapters/sap.js', 'scripts/examples/unist-travel/preset.js'];
async function travel(config) {
  const env = context();
  await load(env.ctx, files[0]); env.window.MacroStudio.config = { unistTravel: config };
  await load(env.ctx, ...files.slice(1));
  return { ...env, helper: env.window.MacroStudio, feature: env.window.MacroStudio.features.travelRequest };
}
async function portalNavigation() {
  const env = await travel(configuration);
  const { ctx, document, window, helper } = env;
  delete env.feature.portalNavigationRegistered;
  const intervals = new Map(), timeouts = new Map(), messages = [];
  let timerId = 0, origin = 'https://portal.unist.ac.kr', definition;
  ctx.setInterval = callback => { const id = ++timerId; intervals.set(id, callback); return id; };
  ctx.clearInterval = id => intervals.delete(id);
  ctx.setTimeout = (callback, delay) => { const id = ++timerId; timeouts.set(id, { callback, delay }); return id; };
  ctx.clearTimeout = id => timeouts.delete(id);
  document.body.innerHTML = '<div toptabindex="9" isselected="true">일반행정</div><div subtabindex="0" isselected="true">인사</div><div nodetitle="국내출장 신청" isselected="true"></div><iframe id="contentAreaFrame"></iframe>';
  const area = context('<html><body><iframe id="isolatedWorkArea" title="국내출장 신청"></iframe></body></html>').document;
  window.top = window;
  const frame = area.getElementById('isolatedWorkArea');
  // The frame title changes before its portal/blank document navigates to SAP.
  Object.defineProperty(document.getElementById('contentAreaFrame'), 'contentDocument', { value: area });
  Object.defineProperty(frame, 'contentDocument', { get: () => origin === 'https://portal.unist.ac.kr' ? area : null });
  const recipient = { postMessage(message, targetOrigin) {
    messages.push({ message: JSON.parse(JSON.stringify(message)), targetOrigin });
    if (origin !== targetOrigin) throw new Error('postMessage target origin does not match recipient origin');
  } };
  Object.defineProperty(frame, 'contentWindow', { value: recipient });
  helper.launcher = { create: () => ({ register: item => { definition = item; } }) };
  await load(ctx, 'scripts/examples/unist-travel/config.js', 'scripts/examples/unist-travel/navigation.js');
  return { ...env, intervals, timeouts, messages,
    enterSAP: () => { origin = 'https://s4hana.unist.ac.kr'; },
    start: () => definition.run({ date: '2026-10-23' }, () => {}).then(value => ({ value }), error => ({ error })),
    receive: (message, source = recipient, senderOrigin = 'https://s4hana.unist.ac.kr') => {
      const event = new window.Event('message');
      Object.assign(event, { source, origin: senderOrigin, data: { channel: 'macro-studio-unist-travel-v1', ...message } });
      window.dispatchEvent(event);
    }
  };
}
test('portal waits through the same-origin loading document, then authenticates SAP messages and stops probing', async () => {
  const env = await portalNavigation();
  const result = env.start();
  await tick();
  assert.equal(env.messages.length, 0, 'Do not send SAP probes to the temporary portal document');
  assert.equal(env.intervals.size, 1);
  const probe = [...env.intervals.values()][0];
  probe(); probe();
  assert.equal(env.messages.length, 0);
  env.enterSAP(); probe();
  assert.equal(env.messages.length, 1);
  assert.equal(env.messages[0].message.type, 'probe');
  assert.equal(env.messages[0].targetOrigin, 'https://s4hana.unist.ac.kr');
  env.receive({ type: 'ready', instance: 'sap-document' }, {});
  env.receive({ type: 'ready', instance: 'sap-document' }, undefined, 'https://portal.unist.ac.kr');
  assert.equal(env.messages.length, 1, 'Other windows and origins cannot start the request');
  env.receive({ type: 'ready', instance: 'sap-document' });
  const run = env.messages[1].message;
  assert.equal(run.type, 'run');
  assert.equal(run.date, '2026.10.23');
  assert.equal(env.messages[1].targetOrigin, 'https://s4hana.unist.ac.kr');
  env.receive({ type: 'started', instance: run.instance, id: 'wrong-job' });
  assert.equal(env.intervals.size, 1);
  env.receive({ type: 'started', instance: run.instance, id: run.id });
  assert.equal(env.intervals.size, 0);
  env.receive({ type: 'complete', instance: run.instance, id: run.id });
  assert.match((await result).value, /결재선 준비 완료/);
  assert.equal(env.timeouts.size, 0);
});
test('portal loading that never reaches SAP times out and clears probes without origin errors', async () => {
  const env = await portalNavigation();
  const result = env.start();
  await tick();
  const timeout = [...env.timeouts.values()].find(timer => timer.delay === 180000);
  assert.ok(timeout);
  timeout.callback();
  assert.match((await result).error.message, /출장 신청 화면이 준비되지 않았습니다/);
  assert.equal(env.messages.length, 0);
  assert.equal(env.intervals.size, 0);
  assert.equal(env.timeouts.size, 0);
});
test('public UNIST example refuses to navigate or fill without personal settings', async () => {
  const { ctx, feature } = await travel(null);
  await load(ctx, 'scripts/examples/unist-travel/config.js', 'scripts/examples/unist-travel/fill.js');
  let navigated = false;
  const definition = feature.launcherDefinition(() => { navigated = true; });
  assert.throws(() => definition.run({ date: '2026-10-23' }), /개인 출장 설정/);
  await assert.rejects(feature.fill('2026.10.23'), /개인 출장 설정/);
  assert.equal(navigated, false);
});
test('UNIST retains the input sequence, checks computed fields and stops on date or write failure', async () => {
  const { ctx, helper, feature } = await travel(configuration);
  await load(ctx, 'scripts/examples/unist-travel/fill.js');
  let values, calls = [], amount = '20,000', fail;
  helper.sap.connect = () => {
    values = new Map([['diff_cp', '4.00'], ['tco_tvamt_cp', amount]]);
    return { runExclusive: (_name, action) => action(), ready: async () => {}, read: key => values.get(key),
      set: async (key, value) => { if (key === fail) throw new Error('응답 실패'); calls.push(key); values.set(key, value); } };
  };
  const result = await feature.fill('2026.10.23');
  assert.equal(result.length, 21);
  assert.deepEqual(calls, ['tco_left2_zztrvcl', 'begda_cp', 'tco_zztrvfd_cp_cp', 'zforyn', 'zjsyn', 'allbt',
    'chk_duplication', 'tco_gunyn_cp', 'chk_society', 'endho_cp', 'endmi_cp', 'begho_cp', 'begmi_cp',
    'zztrvlo_cp', 'zor_cp', 'zztrvpu', 'textedit2', 'textedit1', 'zztrvcm_cp']);
  assert.equal(values.get('begda_cp'), '2026.10.23');
  calls = []; await assert.rejects(feature.fill('2026.02.30'), /실제 날짜/); assert.equal(calls.length, 0);
  amount = '10,000'; await assert.rejects(feature.fill('2026.10.23'), /출장비총액/);
  amount = '20,000'; fail = 'zztrvlo_cp'; calls = [];
  await assert.rejects(feature.fill('2026.10.23'), /출장지 단계/); assert.ok(!calls.includes('zztrvpu'));
});
test('approval flow selects and verifies the configured route and never presses final submission', async () => {
  const { ctx, helper, feature, document, window } = await travel(configuration);
  let clock = 0;
  ctx.Date = class extends Date { static now() { return clock; } };
  ctx.setTimeout = callback => { clock += 1000; queueMicrotask(callback); };
  const actions = [];
  const confirm = '<div role="dialog"><span ct="TV">결재상신을 하시겠습니까?</span><button ct="B" id="yes" lsdata=\'{"0":"예"}\'>예</button></div>';
  const line = '<div role="dialog"><span ct="TV" data-cust-sid-v_main.text02="">[출장]</span><input ct="CB" data-cust-sid-v_main.ddl="" aria-controls="routes"><div id="routes"><div data-itemkey="random" data-itemvalue1="[출장] 예제 결재선"></div></div><table ct="T" data-cust-sid-v_main.talbe=""><tr rt="1"><td role="gridcell">신청자</td></tr><tr rt="1"><td role="gridcell">검토자A 부서</td></tr><tr rt="1"><td role="gridcell">승인자B 부서</td></tr></table><button ct="B" id="final" lsdata=\'{"0":"결재상신"}\'>결재상신</button></div>';
  const session = {
    doc: document, ready: async () => {}, runExclusive: (_name, action) => action(), read: () => '2026.10.23',
    press: async (_button, label) => {
      assert.ok(['신규 결재상신', '예'].includes(label), 'Final submission must remain manual');
      actions.push(label); document.body.innerHTML = label === '예' ? line : confirm;
    },
    set: async (_field, value) => { document.querySelector('[ct="CB"]').value = value; }
  };
  helper.sap.connect = () => session;
  await load(ctx, 'scripts/examples/unist-travel/approval.js');
  const result = await feature.prepareApproval();
  assert.deepEqual(actions, ['신규 결재상신', '예']);
  assert.equal(result.approvalLine, configuration.approvalLine);
  assert.ok(document.getElementById('final'));
  actions.length = 0;
  document.querySelector('tr[rt="1"] + tr td').textContent = '다른 사람';
  await assert.rejects(feature.prepareApproval(), /반영되지 않았습니다/);
  assert.deepEqual(actions, []);
  assert.equal(window.__macroStudioRunningTask, undefined);
});
test('SAP native adapter serializes actions and releases its lock even after errors', async () => {
  const { ctx, helper, document, window } = await travel(configuration);
  document.body.innerHTML = '<input ct="I" id="dynamic1" data-cust-sid-main.date="" value="old">';
  let clock = 0, writes = 0;
  ctx.Date = class extends Date { static now() { return clock; } };
  ctx.setTimeout = callback => { clock += 25; queueMicrotask(callback); };
  window.UCF_Automation = { oLS: { bIsReady: () => true }, Actions: {
    InputField: { ChangeValue: async (id, value) => { writes++; document.getElementById(id).value = value; } }
  } };
  const session = helper.sap.connect('date');
  await session.set('date', 'new'); await session.set('date', 'new'); assert.equal(writes, 1);
  let release;
  const running = session.runExclusive('test', () => new Promise(resolve => { release = resolve; }));
  await assert.rejects(session.runExclusive('other', async () => {}), /자동입력 중/);
  release(); await running;
  await assert.rejects(session.runExclusive('test', async () => { throw new Error('failed'); }), /failed/);
  assert.equal(window.__macroStudioRunningTask, undefined);
});
