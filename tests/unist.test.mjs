import test from 'node:test';
import assert from 'node:assert/strict';
import { context, load } from './helpers.mjs';

const configuration = { destination: '방문 지역', organization: '방문 기관', purpose: '업무 미팅', memo: '검토용 메모',
  approvalLine: '[출장] 예제 결재선', approvers: ['검토자A', '승인자B'] };
const files = ['extension/core/namespace.js', 'extension/adapters/sap.js', 'scripts/examples/unist-travel/preset.js'];
async function travel(config) {
  const env = context();
  await load(env.ctx, files[0]); env.window.MacroStudio.config = { unistTravel: config };
  await load(env.ctx, ...files.slice(1));
  return { ...env, helper: env.window.MacroStudio, feature: env.window.MacroStudio.features.travelRequest };
}
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
