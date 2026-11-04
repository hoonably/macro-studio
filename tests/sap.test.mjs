import test from 'node:test';
import assert from 'node:assert/strict';
import { context, load } from './helpers.mjs';

async function sap(html, actions = {}) {
  const env = context('<html><body>' + html + '</body></html>');
  // Isolate globals explicitly: linkedom's Window proxy shares arbitrary properties between documents.
  const view = { document: env.document, MacroStudio: { features: {} } };
  view.top = view;
  env.window = env.ctx.window = view;
  Object.defineProperty(env.document, 'defaultView', { value: view });
  let clock = 0, readiness = () => true;
  env.ctx.Date = class extends Date { static now() { return clock; } };
  env.ctx.setTimeout = (callback, delay) => { clock += delay; queueMicrotask(callback); };
  env.window.UCF_Automation = { oLS: { bIsReady: () => readiness() }, Actions: actions };
  await load(env.ctx, 'extension/adapters/sap.js');
  return { ...env, helper: env.window.MacroStudio, setReady: read => { readiness = read; }, now: () => clock };
}

test('SAP native adapter serializes actions and releases its lock even after errors', async () => {
  const env = await sap('<input ct="I" id="dynamic1" data-cust-sid-main.date="" value="old">');
  let writes = 0;
  env.window.UCF_Automation.Actions.InputField = { ChangeValue: async (id, value) => {
    writes++; env.document.getElementById(id).value = value;
  } };
  const session = env.helper.sap.connect('date');
  await session.set('date', 'new'); await session.set('date', 'new');
  assert.equal(writes, 1, 'An already applied value does not create another server action');
  let release;
  const running = session.runExclusive('test', () => new Promise(resolve => { release = resolve; }));
  await assert.rejects(session.runExclusive('other', async () => {}), /자동입력 중/);
  release(); await running;
  await assert.rejects(session.runExclusive('test', async () => { throw new Error('failed'); }), /failed/);
  assert.equal(env.window.__macroStudioRunningTask, undefined);
});

test('SAP stable business fields survive dynamic id replacement and missing fields fail clearly', async () => {
  const env = await sap('<input ct="I" id="old-id" data-cust-sid-main.date="" value="old">');
  const writes = [];
  env.window.UCF_Automation.Actions.InputField = { ChangeValue: async (id, value) => {
    writes.push(id); env.document.getElementById(id).value = value;
  } };
  const session = env.helper.sap.connect('date');
  env.document.body.innerHTML = '<input ct="I" id="new-id" data-cust-sid-main.date="" value="old">';
  await session.set('date', 'new');
  assert.deepEqual(writes, ['new-id']);
  assert.equal(session.read('date'), 'new');
  assert.throws(() => session.read('missing'), /입력 항목/);
  assert.throws(() => env.helper.sap.connect('missing'), /화면을 찾지/);
});

test('SAP uses native checkbox, radio, text edit and combo actions and verifies their values', async () => {
  const env = await sap([
    '<input ct="I" data-cust-sid-main.date="" value="old">',
    '<div ct="C" id="check" role="checkbox" aria-checked="false" data-cust-sid-main.enabled=""></div>',
    '<div ct="R" id="radio" role="radio" aria-checked="false" data-cust-sid-main.choice=""></div>',
    '<textarea ct="TE" id="memo" data-cust-sid-main.memo=""></textarea>',
    '<input ct="CB" id="select" aria-controls="options" data-cust-sid-main.category="">',
    '<div id="options"><div id="option" data-itemkey="one" data-itemvalue1="Category A"></div></div>'
  ].join(''));
  const calls = [];
  const boolean = (kind, id, value) => {
    calls.push(kind); env.document.getElementById(id).setAttribute('aria-checked', String(value));
  };
  Object.assign(env.window.UCF_Automation.Actions, {
    CheckBox: { ChangeValue: async (id, value) => boolean('checkbox', id, value) },
    RadioButton: { ChangeValue: async (id, value) => boolean('radio', id, value) },
    TextEdit: { ChangeText: async (id, value) => { calls.push('textarea'); env.document.getElementById(id).value = value; } },
    ComboBox: { SelectListItem: async (id, option) => {
      calls.push('combo'); env.document.getElementById(id).value = env.document.getElementById(option).getAttribute('data-itemvalue1');
    } }
  });
  const session = env.helper.sap.connect('date');
  await session.set('enabled', true);
  await session.set('choice', true);
  await session.set('memo', 'Review before submitting');
  await session.set('category', 'Category A');
  assert.deepEqual(calls, ['checkbox', 'radio', 'textarea', 'combo']);
  assert.equal(session.read('enabled'), true);
  assert.equal(session.read('choice'), true);
  assert.equal(session.read('memo'), 'Review before submitting');
  assert.equal(session.read('category'), 'Category A');
  await assert.rejects(session.set('category', 'Missing category'), /선택 항목/);
  assert.equal(calls.length, 4, 'A missing list item never dispatches a selection');
});

test('SAP rejects unapplied writes and propagates native action failures while releasing the lock', async () => {
  const env = await sap('<input ct="I" id="date" data-cust-sid-main.date="" value="old">', {
    InputField: { ChangeValue: async () => {} }
  });
  const session = env.helper.sap.connect('date');
  await assert.rejects(session.runExclusive('write', () => session.set('date', 'new')), /반영되지 않았습니다/);
  assert.equal(env.window.__macroStudioRunningTask, undefined);
  env.window.UCF_Automation.Actions.InputField.ChangeValue = async () => { throw new Error('Native action failed'); };
  await assert.rejects(session.runExclusive('write', () => session.set('date', 'new')), /Native action failed/);
  assert.equal(env.window.__macroStudioRunningTask, undefined);
});

test('SAP waits for stable readiness and times out without changing an input', async () => {
  let writes = 0;
  const env = await sap('<input ct="I" id="date" data-cust-sid-main.date="" value="old">', {
    InputField: { ChangeValue: async () => { writes++; } }
  });
  const session = env.helper.sap.connect('date');
  env.setReady(() => env.now() >= 100);
  await session.ready();
  assert.ok(env.now() >= 150, 'Readiness must stay stable for the settlement interval');
  env.setReady(() => false);
  await assert.rejects(session.set('date', 'new'), /30초/);
  assert.equal(writes, 0);
  assert.equal(session.read('date'), 'old');
});

test('SAP button actions verify the label, connection and native API before pressing', async () => {
  const env = await sap('<div ct="B" id="prepare" data-cust-sid-main.prepare="" lsdata=\'{"0":"준비 화면 열기"}\'></div>');
  const pressed = [];
  env.window.UCF_Automation.Actions.Button = { Press: async id => { pressed.push(id); } };
  const button = env.document.getElementById('prepare');
  const session = env.helper.sap.connectButton(button);
  await assert.rejects(session.press('prepare', 'Other action'), /예상과 다릅니다/);
  assert.deepEqual(pressed, []);
  await session.press('prepare', '준비 화면 열기');
  assert.deepEqual(pressed, ['prepare']);
  button.remove();
  await assert.rejects(session.press(button, '준비 화면 열기'), /버튼을 찾지/);
  delete env.window.UCF_Automation;
  assert.throws(() => env.helper.sap.connectButton(button), /준비된 뒤/);
});

test('SAP finds accessible nested frames and skips frames from another origin', async () => {
  const env = await sap('<iframe id="foreign"></iframe><iframe id="same"></iframe>');
  const child = context('<input ct="I" id="child-date" data-cust-sid-main.date="" value="current">');
  const otherOrigin = {};
  Object.defineProperty(otherOrigin, 'document', { get() { throw new Error('Cross-origin access denied'); } });
  Object.defineProperty(env.document.getElementById('foreign'), 'contentWindow', { value: otherOrigin });
  const sameOrigin = { document: child.document, UCF_Automation: env.window.UCF_Automation };
  Object.defineProperty(env.document.getElementById('same'), 'contentWindow', { value: sameOrigin });
  const session = env.helper.sap.connect('date');
  assert.equal(session.win, sameOrigin);
  assert.equal(session.read('date'), 'current');
});
