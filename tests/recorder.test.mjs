import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent, normalizeFieldContext, safeURL, agentPrompt, exportRecording, DEFAULT_STOP_BEFORE } from '../extension/recorder/model.js';
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
  assert.match(prompt, /mode=fixed여도 fields에 최대한 노출/);
  assert.match(prompt, /기록값을 기본값/);
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
  assert.match(prompt, /결재선 선택 창을 여는 것과 최종 결재상신/);
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

test('store prompts are self-contained and do not require a clone or build', () => {
  const prompt = agentPrompt({ name: '내 작업', steps: [] }, { standalone: true, goal: '입력까지' });
  assert.match(prompt, /scripts\/<id>\//);
  assert.match(prompt, /script\.json 형식/);
  assert.match(prompt, /launcher\.create\(\)\.register/);
  assert.match(prompt, /사용자 스크립트 허용/);
  assert.doesNotMatch(prompt, /AGENTS\.md|npm run verify|local\/scripts|이 저장소/);
  assert.match(prompt, /관찰 자료/);
  assert.match(prompt, /최종 제출/);
});


async function choiceCapture(t, html) {
  const messages = [], listeners = [];
  const chrome = { runtime:{ onMessage:{addListener:listener=>listeners.push(listener)},
    sendMessage:async message=>{ messages.push(message); return message.type === 'capture:status'
      ? {ok:true,value:{recordingId:'choices'}} : {ok:true}; } } };
  const env = context(html, {chrome});
  env.window.__macroStudioCaptureInstalled = false;
  // Linkedom does not propagate document events through the window capture phase.
  const earlyListeners = new Map();
  const add = env.window.addEventListener.bind(env.window);
  env.window.addEventListener = (type, listener, options) => {
    if (options === true && ['pointerdown','keydown'].includes(type)) earlyListeners.set(type,listener);
    else add(type,listener,options);
  };
  const point = target => earlyListeners.get('pointerdown')({isTrusted:true,target,composedPath:()=>[target]});
  const key = (target,key) => earlyListeners.get('keydown')({isTrusted:true,target,key,composedPath:()=>[target]});
  await load(env.ctx, 'extension/recorder/capture.js'); await tick();
  const stop = () => listeners[0]({type:'capture:state',recordingId:null},{},()=>{});
  t.after(stop);
  return {...env,messages,stop,point,key, changes:()=>messages.filter(message=>message.event?.action==='change').map(message=>message.event)};
}

test('SAP custom checkbox/radio changes survive rerenders, normalization and prompt export as booleans', async t => {
  const env = await choiceCapture(t, `<html><body>
    <span ct="C" data-cust-sid-main.confirm role="checkbox" aria-checked="false" aria-label="확인"><span id="check-label">선택</span></span>
    <span ct="R" data-cust-sid-main.method role="radio" aria-checked="false" aria-label="방식"><span id="radio-label">선택</span></span>
    </body></html>`);
  const check = env.document.querySelector('[role="checkbox"]');
  env.point(env.document.getElementById('check-label'));
  check.setAttribute('aria-checked','true');
  // Synthetic framework change is not a separate trusted action.
  check.dispatchEvent(new env.window.Event('change',{bubbles:true}));
  trusted(env.window, env.document.getElementById('check-label'), 'click'); await tick();
  assert.equal(env.changes().length,1);
  check.setAttribute('aria-checked','true'); await tick();
  assert.equal(env.changes().length,1,'Unchanged rerenders do not manufacture steps');
  env.point(check);check.setAttribute('aria-checked','false');await tick();
  assert.equal(env.changes()[1].value,false,'Unchecking must retain false rather than disappear');
  const radio = env.document.querySelector('[role="radio"]');
  env.key(env.document.getElementById('radio-label'),' ');
  radio.outerHTML = '<span ct="R" data-cust-sid-main.method role="radio" aria-label="방식" aria-checked="true" id="WD-new"></span>';
  await tick();
  assert.equal(env.changes().at(-1).value,true);
  assert.equal(env.changes().at(-1).target.sapField,'main.method');
  const steps = env.changes().map(event=>normalizeEvent(event,{frameId:3}));
  const prompt = agentPrompt({name:'예시',steps});
  const exported = JSON.parse(prompt.match(/<recording-data>\s*([\s\S]*?)\s*<\/recording-data>/)[1]);
  assert.deepEqual(exported.steps.map(step=>step.value),[true,false,true]);
  assert.deepEqual(exported.steps.map(step=>step.target.sapField),['main.confirm','main.confirm','main.method']);
});

test('SAP combo options resolve their owner outside the input and capture the resulting displayed value once', async t => {
  const env = await choiceCapture(t, `<html><body>
    <input ct="CB" data-cust-sid-main.delivery role="combobox" readonly aria-label="처리 방식" aria-controls="choices" value="기존 방식">
    <div id="choices"><div role="option" data-itemkey="later"><span id="option-label">나중에 처리</span></div></div><input readonly name="calculatedTotal" value="0">
    </body></html>`);
  const combo = env.document.querySelector('[ct="CB"]');
  trusted(env.window,combo,'click');await tick();
  assert.equal(env.changes().length,0,'Opening the list is not a value change');
  env.point(env.document.getElementById('option-label'));
  combo.value='나중에 처리';
  env.document.querySelector('[name="calculatedTotal"]').value='99999';
  trusted(env.window,env.document.getElementById('option-label'),'click');await tick();
  assert.deepEqual(env.changes().map(event=>event.value),['나중에 처리']);
  assert.equal(env.changes()[0].target.sapField,'main.delivery');
});

test('custom-state observation requires a trusted interaction, rejects secrets, and stops with the recording', async t => {
  const env = await choiceCapture(t, `<html><body>
    <span ct="C" role="checkbox" aria-checked="false" aria-label="일반 설정"></span>
    <span ct="C" role="checkbox" aria-checked="false" aria-label="secret token"></span>
    </body></html>`);
  const [normal, secret] = env.document.querySelectorAll('[role="checkbox"]');
  normal.dispatchEvent(new env.window.Event('click',{bubbles:true}));
  normal.setAttribute('aria-checked','true');
  env.point(secret);secret.setAttribute('aria-checked','true');await tick();
  assert.equal(env.changes().length,0);
  env.point(normal);normal.setAttribute('aria-checked','false');await tick();
  assert.equal(env.changes().length,1);
  env.stop(); normal.setAttribute('aria-checked','true');await tick();
  assert.equal(env.changes().length,1);
});


test('calendar popup changes a focused SAP date field without input/change events or a value attribute mutation', async t => {
  const env = await choiceCapture(t, `<html><body>
    <span ct="date-wrapper"><input ct="I" data-cust-sid-main.visitDate aria-label="날짜" type="text" value="2026.11.11"><span id="calendar-icon">달력</span></span>
    <div id="calendar-popup"><span id="calendar-day">다음 날짜</span></div>
    <input readonly name="calculatedTotal" value="0">
    </body></html>`);
  const date = env.document.querySelector('[aria-label="날짜"]');
  // Model a property-only update: no native input/change and no observed DOM mutation.
  let displayed = date.value;
  Object.defineProperty(date,'value',{get:()=>displayed,set:value=>{displayed=value;}});
  env.point(env.document.getElementById('calendar-icon'));
  trusted(env.window,env.document.getElementById('calendar-icon'),'click');await tick();
  assert.equal(env.changes().length,0,'Opening a date picker is not a date change');
  trusted(env.window,env.document.getElementById('calendar-day'),'click');
  date.value='2026.11.12';
  env.document.querySelector('[name="calculatedTotal"]').value='99999';await tick();
  assert.deepEqual(env.changes().map(event=>[event.target.sapField,event.value]),[['main.visitDate','2026.11.12']]);
  const exported=exportRecording({name:'날짜 예시',steps:env.changes().map(event=>normalizeEvent(event))});
  assert.equal(exported.steps[0].target.label,'날짜');
  assert.equal(exported.steps[0].value,'2026.11.12');
});

test('tracking a focused native field keeps its trusted change and does not add a duplicate fallback', async t => {
  const env = await choiceCapture(t,'<html><body><input name="visitDate" value="before"></body></html>');
  const field=env.document.querySelector('input');
  trusted(env.window,field,'focusin');field.value='after';
  trusted(env.window,field,'input');trusted(env.window,field,'change');await tick();
  assert.deepEqual(env.changes().map(event=>event.value),['after']);
});


test('generic clicks, gestures, rich text and unchanged form metadata do not depend on button tags', async t => {
  const env=await choiceCapture(t,`<html><body><form>
    <div id="custom"><span id="child">사용자 메뉴</span></div>
    <input name="minute" aria-label="분" value="00">
    <div contenteditable="true" aria-label="메모">이전</div>
    <input name="credential" aria-label="비밀번호" value="DO_NOT_COLLECT">
  </form></body></html>`);
  const child=env.document.getElementById('child');env.point(child);
  for(const type of ['click','dblclick','contextmenu','auxclick']) {
    const event=new env.window.Event(type,{bubbles:true});
    Object.defineProperties(event,{isTrusted:{value:true},button:{value:type==='auxclick'?1:type==='contextmenu'?2:0}});
    child.dispatchEvent(event);
  }
  const rich=env.document.querySelector('[contenteditable]');trusted(env.window,rich,'focusin');
  rich.textContent='다음';trusted(env.window,rich,'input');trusted(env.window,rich,'change');await tick();
  assert.deepEqual(env.messages.filter(m=>m.event?.evidence==='interaction').map(m=>m.event.action),['click','dblclick','contextmenu','auxclick']);
  assert.ok(env.changes().some(event=>event.value==='다음'));
  assert.ok(!env.changes().some(event=>event.target.name==='minute'),'Untouched default is not a user change');
  const rawContexts=env.messages.filter(m=>m.type==='capture:context').map(m=>m.context);
  const contexts=rawContexts.map(context=>normalizeFieldContext(context));
  assert.ok(contexts.some(context=>context.fields.some(field=>field.name==='minute')),'Untouched controls remain identifiable');
  assert.ok(!JSON.stringify(rawContexts).includes('DO_NOT_COLLECT'));
  assert.ok(!JSON.stringify(contexts).includes('"value"'));
  const exported=exportRecording({name:'예시',steps:[],fieldContexts:contexts});
  assert.ok(exported.fieldContexts.length);
  assert.match(agentPrompt({name:'예시',steps:[],fieldContexts:contexts}),/특정 값으로 설정했다는 뜻이 아니야/);
});

test('context normalization excludes secrets, drops values and bounds metadata',()=>{
  const fields=Array.from({length:200},(_,i)=>({name:'field'+i,type:'text',value:'must not be copied',selectors:['input'],shadowPath:[['#host']]}));
  fields.unshift({type:'password',value:'DO_NOT_COLLECT'},{label:'api token',value:'DO_NOT_COLLECT'});
  const context=normalizeFieldContext({page:{url:'https://example.test/form?secret=x'},fields});
  assert.equal(context.fields.length,148);
  assert.equal(context.page.url,'https://example.test/form');
  assert.ok(!JSON.stringify(context).includes('must not be copied'));
  assert.ok(!JSON.stringify(context).includes('DO_NOT_COLLECT'));
});


test('export preserves iframe field identities beyond one metadata batch without including current values',()=>{
  const context={frameId:7,page:{url:'https://frame.test/form'},fields:Array.from({length:190},(_,i)=>({name:'field'+i,value:'not an action'}))};
  const exported=exportRecording({name:'예시',steps:[],fieldContexts:[context]});
  assert.equal(exported.fieldContexts[0].frameId,7);
  assert.equal(exported.fieldContexts[0].fields.length,190);
  assert.ok(exported.fieldContexts[0].fields.every(field=>!('value' in field)));
});


test('a newly opened asynchronous form exposes identifiers without copying untouched textarea or rich-text values',async t=>{
  const env=await choiceCapture(t,'<html><body><button type="button" id="open">양식 열기</button></body></html>');
  trusted(env.window,env.document.querySelector('button'),'click');
  await tick();
  const modal=env.document.createElement('div');modal.setAttribute('role','dialog');
  modal.innerHTML='<input name="newDate" type="date" value="2026-12-01"><textarea name="notes">UNTOUCHED_TEXT_VALUE</textarea><div contenteditable="true" id="rich">UNTOUCHED_RICH_VALUE</div>';
  env.document.body.append(modal);await tick();await tick();
  const contexts=env.messages.filter(m=>m.type==='capture:context').map(m=>m.context);
  assert.ok(contexts.some(c=>c.fields.some(f=>f.name==='newDate')));
  assert.doesNotMatch(JSON.stringify(contexts),/UNTOUCHED_TEXT_VALUE|UNTOUCHED_RICH_VALUE|2026-12-01/);
  assert.equal(env.changes().length,0);
});
