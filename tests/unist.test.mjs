import test from 'node:test';
import assert from 'node:assert/strict';
import { context, load, tick } from './helpers.mjs';

const configuration = { destination: '방문 지역', organization: '방문 기관', purpose: '업무 미팅', memo: '검토용 메모',
  approvalLine: '[출장] 예제 결재선', approvers: ['검토자A', '승인자B'] };
const files = ['extension/core/namespace.js', 'extension/adapters/sap.js',
  'scripts/examples/unist-travel/preset.js', 'scripts/examples/unist-travel/inputs.js'];
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
    values = new Map([['diff_cp', '4.00'], ['tco_tvamt_cp', amount],
      ['begho_cp', '13'], ['begmi_cp', '00'], ['endho_cp', '17'], ['endmi_cp', '00']]);
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

test('per-run date and time inputs reject invalid values before navigation and leave shared defaults unchanged', async () => {
  const env = await portalNavigation();
  const original = JSON.stringify(env.feature.preset);
  for (const [date, inputs] of [
    ['2026.02.30', {}], ['2026.10.23', { startTime: '24:00' }],
    ['2026.10.23', { startTime: '' }], ['2026.10.23', { startTime: '17:00', endTime: '17:00' }],
    ['2026.10.23', { startTime: '17:00', endTime: '09:00' }]
  ]) assert.throws(() => env.feature.runFromPortal(date, () => {}, inputs), /날짜|시간/);
  assert.equal(env.messages.length, 0);
  assert.equal(env.intervals.size, 0);
  const trip = env.feature.resolveTrip('2026.10.23', { startTime: '09:30', endTime: '12:00' });
  assert.equal(trip.preset.startHour, '09');
  assert.equal(trip.preset.startMinute, '30');
  assert.equal(trip.preset.endHour, '12');
  assert.equal(trip.preset.expectedHours, 2.5);
  assert.equal(trip.preset.expectedAmount, null, 'Do not guess a different-duration reimbursement rule');
  assert.equal(env.feature.resolveTrip('2026.10.23', { startTime: '09:00', endTime: '13:00' }).preset.expectedAmount, 20000);
  assert.equal(JSON.stringify(env.feature.preset), original);
});

test('portal bridge carries a snapshot of per-run times and private preset without changing the shared example', async () => {
  const env = await portalNavigation();
  const original = JSON.stringify(env.feature.preset);
  const result = env.feature.runFromPortal('2026.10.23', () => {}, {
    startTime: '09:30', endTime: '12:00', preset: { ...configuration, purpose: '개별 업무' }
  });
  await tick(); env.enterSAP();
  [...env.intervals.values()][0]();
  env.receive({ type: 'ready', instance: 'current-sap' });
  const run = env.messages.find(item => item.message.type === 'run').message;
  assert.equal(run.inputs.preset.startHour, '09');
  assert.equal(run.inputs.preset.startMinute, '30');
  assert.equal(run.inputs.preset.endHour, '12');
  assert.equal(run.inputs.preset.purpose, '개별 업무');
  assert.equal(run.inputs.preset.expectedAmount, null);
  env.receive({ type: 'started', instance: run.instance, id: run.id });
  env.receive({ type: 'complete', instance: run.instance, id: run.id });
  assert.match(await result, /최종 결재상신을 직접/);
  assert.equal(JSON.stringify(env.feature.preset), original);
});

test('variable-time filling keeps every intermediate time range valid and checks SAP calculations', async () => {
  const { ctx, helper, feature } = await travel(configuration);
  await load(ctx, 'scripts/examples/unist-travel/fill.js');
  let amount = '10,000', fail, calls, initial = ['13', '00', '17', '00'];
  helper.sap.connect = () => {
    calls = [];
    const values = new Map(['begho_cp', 'begmi_cp', 'endho_cp', 'endmi_cp'].map((key, index) => [key, initial[index]]));
    return { runExclusive: (_name, action) => action(), ready: async () => {},
      read: key => key === 'diff_cp' ? (Number(values.get('endho_cp')) + Number(values.get('endmi_cp')) / 60 -
        Number(values.get('begho_cp')) - Number(values.get('begmi_cp')) / 60).toFixed(2) : key === 'tco_tvamt_cp' ? amount : values.get(key),
      set: async (key, value) => {
        calls.push(key);
        if (key === fail) throw new Error('입력 실패');
        values.set(key, value);
        const start = Number(values.get('begho_cp')) * 60 + Number(values.get('begmi_cp'));
        const end = Number(values.get('endho_cp')) * 60 + Number(values.get('endmi_cp'));
        if (['begho_cp', 'begmi_cp', 'endho_cp', 'endmi_cp'].includes(key)) {
          assert.ok(end > start, 'Never present SAP with an invalid intermediate time range');
        }
      }
    };
  };
  const inputs = { startTime: '09:30', endTime: '12:00', preset: { ...configuration, purpose: '이번 업무' } };
  const rows = await feature.fill('2026.10.23', () => {}, inputs);
  assert.equal(rows.find(row => row.항목 === '출장시간').현재값, '2.50');
  assert.equal(rows.find(row => row.항목 === '출장목적').현재값, '이번 업무');
  assert.ok(calls.indexOf('begho_cp') < calls.indexOf('endho_cp'));
  initial = ['00', '00', '00', '00'];
  const rounded = await feature.fill('2026.10.23', () => {}, { ...inputs, startTime: '09:20' });
  assert.equal(rounded.find(row => row.항목 === '출장시간').현재값, '2.67');
  for (const invalid of ['', 'NaN', '-1', '오류']) {
    amount = invalid;
    await assert.rejects(feature.fill('2026.10.23', () => {}, inputs), /출장비총액/);
  }
  amount = '10,000'; fail = 'begho_cp';
  await assert.rejects(feature.fill('2026.10.23', () => {}, inputs), /단계에서 중단/);
  assert.ok(!calls.includes('zztrvlo_cp'));
});

test('SAP list forwards variable inputs, and an open approval popup refuses a different time', async () => {
  const { ctx, helper, feature, document } = await travel(configuration);
  document.body.innerHTML = '<button ct="B" lsdata=\'{"0":"신청"}\'>신청</button>';
  let presses = 0, forwarded;
  helper.sap.connectButton = () => ({ ready: async () => {}, press: async () => {
    presses++;
    document.body.innerHTML = '<input ct="I" data-cust-sid-main.begda_cp=""><button ct="B" lsdata=\'{"0":"신규 결재상신"}\'>신규 결재상신</button>';
  } });
  feature.run = async (...args) => { forwarded = args; };
  await load(ctx, 'scripts/examples/unist-travel/bridge.js');
  await assert.rejects(feature.runFromList('2026.10.23', () => {}, { startTime: '25:00' }), /시간/);
  assert.equal(presses, 0);
  const inputs = { startTime: '09:30', endTime: '12:00' };
  await feature.runFromList('2026.10.23', () => {}, inputs);
  assert.equal(presses, 1);
  assert.equal(forwarded[2], inputs);
  await load(ctx, 'scripts/examples/unist-travel/approval.js');
  document.body.innerHTML = '<div role="dialog"><span ct="TV">결재상신을 하시겠습니까?</span></div>';
  helper.sap.connect = () => ({ doc: document, read: key => ({ begda_cp: '2026.10.23',
    begho_cp: '13', begmi_cp: '00', endho_cp: '17', endmi_cp: '00' })[key] });
  let approved = false;
  feature.prepareApproval = async () => { approved = true; };
  await assert.rejects(feature.run('2026.10.23', () => {}, inputs), /날짜·시간/);
  assert.equal(approved, false);
  const existing = Object.fromEntries(feature.tripTasks('2026.10.23', feature.resolveTrip('2026.10.23', inputs).preset)
    .map(([, key, value]) => [key, value]));
  helper.sap.connect = () => ({ doc: document, read: key => existing[key] });
  existing.zztrvpu = '다른 출장 목적';
  await assert.rejects(feature.run('2026.10.23', () => {}, inputs), /입력값/);
  assert.equal(approved, false);
  existing.zztrvpu = configuration.purpose;
  await feature.run('2026.10.23', () => {}, inputs);
  assert.equal(approved, true);
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
