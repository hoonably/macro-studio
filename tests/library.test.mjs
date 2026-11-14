import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { context, code, load, tick } from './helpers.mjs';
import { LIBRARY_KEY, changeLibrary, matchesSite } from '../extension/core/script-library.js';

test('launcher waits for storage, blocks archived/stale runs, restores items and disables management while running', async () => {
  const { ctx, window, document } = context();
  window.MacroStudio = { features: {} };
  await load(ctx, 'extension/ui/launcher.js');
  const app = window.MacroStudio.launcher.create(), host = document.getElementById('macro-studio-launcher'), shadow = host.shadowRoot;
  assert.equal(host.hidden, true);
  assert.equal(host.style.display, 'none');
  let runs = 0, release;
  app.register({ id: 'task', name: '테스트', run: () => { runs++; return new Promise(resolve => { release = resolve; }); } });
  assert.equal(shadow.querySelectorAll('.script').length, 0);
  assert.equal(host.hidden, true, 'No icon flashes before stored deletion state is loaded');
  app.applyLibraryState({ ready: true, archived: [], deleted: [] });
  assert.equal(host.hidden, false);
  const stale = shadow.querySelector('.script'); stale.click();
  const form = shadow.querySelector('form'); form.reportValidity = () => true;
  app.applyLibraryState({ ready: true, archived: ['task'], deleted: [] });
  assert.equal(host.hidden, false, 'Archived scripts keep library access available');
  stale.click(); form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.equal(runs, 0); assert.equal(shadow.querySelectorAll('.script').length, 0);
  assert.equal(shadow.querySelector('.config').hidden, true);
  app.applyLibraryState({ ready: true, archived: [], deleted: [] });
  shadow.querySelector('.script').click(); form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.equal(runs, 1); assert.equal(shadow.querySelector('.script-archive').disabled, true);
  app.applyLibraryState({ ready: true, archived: [], deleted: ['task'] });
  assert.equal(host.hidden, false, 'Deleting from another tab does not hide an in-progress task');
  release(); await tick();
  assert.equal(shadow.querySelectorAll('.script').length, 0);
  assert.equal(host.hidden, true);
  assert.equal(host.style.display, 'none');
  form.dispatchEvent(new window.Event('submit', { cancelable: true })); assert.equal(runs, 1);
});

test('empty and fully deleted sites stay hidden after loading; a new script makes the icon appear', async () => {
  const { ctx, window, document } = context();
  window.MacroStudio = { features: {} };
  await load(ctx, 'extension/ui/launcher.js');
  const app = window.MacroStudio.launcher.create(), host = document.getElementById('macro-studio-launcher');
  app.applyLibraryState({ ready: true, archived: [], deleted: [] });
  assert.equal(host.hidden, true, 'A site with no macros uses the Chrome toolbar to start recording');
  app.applyLibraryState({ ready: true, archived: [], deleted: ['old-task'] });
  app.register({ id: 'old-task', name: '삭제한 작업', run: async () => {} });
  assert.equal(host.hidden, true, 'Loading the original source cannot revive a deleted script');
  app.register({ id: 'new-task', name: '새 작업', run: async () => {} });
  assert.equal(host.hidden, false);
  assert.equal(host.style.display, 'block');
  host.shadowRoot.querySelector('.orb').click();
  assert.equal(host.shadowRoot.querySelector('.panel').hidden, false);
  app.applyLibraryState({ ready: true, archived: [], deleted: ['old-task', 'new-task'] });
  assert.equal(host.hidden, true);
  assert.equal(host.shadowRoot.querySelector('.panel').hidden, true, 'Removing the last script also closes its menu');
});

test('isolated bridge archives only trusted clicks in its launcher and reports write failures', async () => {
  const { ctx, window, document } = context();
  window.MacroStudio = { features: {} }; delete window.__macroStudioEntryInstalled;
  let state = { ready: true, archived: [], deleted: [] }, fail = false, changes, approveArchive = false;
  const calls = [];
  const confirmations = [];
  window.confirm = message => { confirmations.push(message); return approveArchive; };
  ctx.CustomEvent = window.CustomEvent; ctx.MutationObserver = window.MutationObserver;
  ctx.chrome = {
    runtime: { onMessage: { addListener() {} }, getManifest: () => ({ content_scripts: [{ world: 'MAIN', matches: ['https://example.test/*'] }] }),
      sendMessage: async message => {
        calls.push(message);
        if (message.type === 'scripts:archive') {
          if (fail) return { ok: false, error: '저장 실패' };
          state = { ready: true, ...changeLibrary(state, 'archive', message.id) };
        }
        return { ok: true, value: structuredClone(state) };
      } },
    storage: { onChanged: { addListener: listener => { changes = listener; } } }
  };
  await load(ctx, 'extension/ui/launcher.js');
  const app = window.MacroStudio.launcher.create();
  app.register({ id: 'task', name: '테스트', run: async () => {} });
  await load(ctx, 'extension/core/studio-entry.js'); await tick();
  const host = document.getElementById('macro-studio-launcher'), shadow = host.shadowRoot;
  const click = (button, trusted) => {
    const event = new window.Event('click', { cancelable: true });
    Object.defineProperty(event, 'isTrusted', { value: trusted });
    event.composedPath = () => [button, shadow, host, document, window];
    document.dispatchEvent(event);
  };
  click(shadow.querySelector('.script-archive'), false); await tick();
  assert.equal(calls.filter(call => call.type === 'scripts:archive').length, 0);
  assert.equal(confirmations.length, 0, 'Synthetic clicks do not open confirmation');
  click(shadow.querySelector('.script-archive'), true); await tick();
  assert.equal(confirmations.length, 1);
  assert.match(confirmations[0], /테스트/);
  assert.equal(calls.filter(call => call.type === 'scripts:archive').length, 0, 'Cancel keeps the script active');
  approveArchive = true;
  host.dispatchEvent(new window.CustomEvent('macro-studio:library-state', { detail: JSON.stringify({ ready: true, archived: ['task'], deleted: [] }) }));
  assert.equal(calls.filter(call => call.type === 'scripts:archive').length, 0, 'Presentation events cannot mutate storage');
  changes({ [LIBRARY_KEY]: {} }, 'local'); await tick();
  fail = true; click(shadow.querySelector('.script-archive'), true); await tick();
  assert.match(shadow.querySelector('.list-status').textContent, /저장 실패/);
  assert.ok(shadow.querySelector('.script'));
  fail = false; click(shadow.querySelector('.script-archive'), true); await tick();
  assert.equal(shadow.querySelectorAll('.script').length, 0);
  assert.deepEqual(state.archived, ['task']);
  state.archived = []; changes({ [LIBRARY_KEY]: {} }, 'local'); await tick();
  assert.ok(shadow.querySelector('.script'), 'Restoring in the library updates open page lists');
});

test('library screen archives and restores; deletion requires confirmation and a failed save stays recoverable', async () => {
  const { ctx, window, document } = context(await code('extension/ui/library.html'));
  const catalog = [{ id: 'task', name: '<img src=x> 예제', matches: ['https://example.test/*'] }];
  let state = { ready: true, catalog, archived: [], deleted: [] }, fail = false, changed;
  window.confirm = () => { throw new Error('Reversible archive needs no modal'); };
  const calls = [], dialog = document.getElementById('delete-dialog');
  dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; };
  ctx.URL = URL; ctx.chrome = {
    runtime: { sendMessage: async message => {
      calls.push(message);
      if (message.type !== 'scripts:state') {
        if (fail) return { ok: false, error: '저장 실패' };
        state = { ready: true, ...changeLibrary(state, message.type.slice(8), message.id), catalog };
      }
      return { ok: true, value: structuredClone(state) };
    } }, storage: { onChanged: { addListener: callback => { changed = callback; } } }
  };
  vm.runInContext((await code('extension/ui/script-name-editor.js')).replace('export function','function') + ';globalThis.scriptName=scriptName;', ctx);
  await vm.runInContext('(async () => {' + (await code('extension/ui/library.js')).replace(/^import[^\n]+\n/gm, '') + '\n})()', ctx);
  const buttons = list => [...document.querySelectorAll(list + ' button')];
  assert.equal(document.querySelector('#active-scripts img'), null, 'Script names are rendered as text');
  const card = document.querySelector('#active-scripts li');
  changed({ macroStudioLocalScripts: {} }, 'local'); await tick();
  assert.equal(document.querySelector('#active-scripts li'), card, 'Unchanged state preserves nodes');
  const search = document.querySelector('#script-search');
  search.value = 'missing'; search.dispatchEvent(new window.Event('input'));
  assert.equal(card.hidden, true); assert.equal(document.querySelector('#search-empty').hidden, false);
  search.value = 'example.test'; search.dispatchEvent(new window.Event('input'));
  assert.equal(card.hidden, false);
  search.value = ''; search.dispatchEvent(new window.Event('input'));
  buttons('#active-scripts')[0].click(); await tick();
  assert.equal(document.querySelector('#active-count').textContent, '0개');
  assert.equal(document.querySelector('#undo-archive').hidden, false);
  document.querySelector('#undo-archive').click(); await tick();
  assert.equal(document.querySelector('#active-count').textContent, '1개');
  buttons('#active-scripts')[0].click(); await tick();
  document.querySelector('#archived-tab').click();
  assert.equal(document.querySelector('#active-panel').hidden, true);
  assert.equal(document.querySelector('#archived-panel').hidden, false);
  buttons('#archived-scripts')[1].click();
  assert.equal(dialog.open, true); assert.equal(calls.filter(call => call.type === 'scripts:delete').length, 0);
  document.querySelector('#cancel-delete').click(); assert.equal(dialog.open, false);
  buttons('#archived-scripts')[1].click(); fail = true;
  document.querySelector('#confirm-delete').click(); await tick();
  assert.equal(dialog.open, true); assert.match(document.querySelector('#library-status').textContent, /저장 실패/);
  assert.equal(buttons('#archived-scripts')[0].disabled, false);
  fail = false; document.querySelector('#confirm-delete').click(); await tick();
  assert.equal(dialog.open, false); assert.equal(document.querySelector('#archived-count').textContent, '0개');
  assert.deepEqual(state.deleted, ['task']);
});

test('script site scope rejects lookalike hosts and supports wildcard subdomains', () => {
  assert.equal(matchesSite('https://*.example.test/form*', 'https://example.test/form'), true);
  assert.equal(matchesSite('https://*.example.test/form*', 'https://sub.example.test/form?x=1'), true);
  assert.equal(matchesSite('https://*.example.test/*', 'https://example.test.attacker.test/form'), false);
  assert.equal(matchesSite('https://example.test/*', 'http://example.test/form'), false);
});

test('explicit ON provides creation on empty/deleted sites; OFF blocks stale controls until an active run completes', async () => {
  const { ctx, window, document } = context();
  window.MacroStudio = { features: {} };
  await load(ctx, 'extension/ui/launcher.js');
  const app = window.MacroStudio.launcher.create(), host = document.getElementById('macro-studio-launcher'), shadow = host.shadowRoot;
  const state = { ready: true, siteEnabled: true, archived: [], deleted: [] };
  app.applyLibraryState(state);
  assert.equal(host.hidden, false, 'ON shows an entry point even without a script');
  shadow.querySelector('.orb').click();
  assert.equal(shadow.querySelector('.studio-open').disabled, false);
  app.applyLibraryState({ ...state, deleted: ['task'] });
  assert.equal(host.hidden, false, 'Deleting every script does not disable explicit ON');
  let runs = 0, finish;
  app.register({ id: 'task', name: '작업', run: () => { runs++; return new Promise(resolve => { finish = resolve; }); } });
  app.applyLibraryState(state);
  const stale = shadow.querySelector('.script'); stale.click();
  const form = shadow.querySelector('form'); form.reportValidity = () => true;
  app.applyLibraryState({ ...state, siteEnabled: false });
  assert.equal(host.hidden, true); assert.equal(shadow.querySelector('.panel').hidden, true);
  stale.click(); form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.equal(runs, 0);
  app.applyLibraryState(state);
  shadow.querySelector('.script').click(); form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  assert.equal(runs, 1);
  app.applyLibraryState({ ...state, siteEnabled: false });
  assert.equal(host.hidden, false, 'Let an already running job finish');
  assert.equal(shadow.querySelector('.studio-open').disabled, true);
  finish(); await tick();
  assert.equal(host.hidden, true);
});

test('common launcher locks and hides values, restores fields, and preserves locks after execution failure',async()=>{
 const {ctx,window,document}=context();window.MacroStudio={features:{}};
 await load(ctx,'extension/ui/launcher.js');const app=window.MacroStudio.launcher.create();let received;
 app.register({id:'task',name:'샘플',fields:[{name:'place',label:'장소',value:'기본 장소'},{name:'time',label:'시각',type:'select',value:'09',options:[{value:'09',label:'오전 9시'}]}],run:async values=>{received=values;throw Error('테스트 중단');}});
 app.applyLibraryState({ready:true,siteEnabled:true,archived:[],deleted:[]});
 const root=document.getElementById('macro-studio-launcher').shadowRoot;root.querySelector('.script').click();
 const field=name=>[...root.querySelectorAll('.field')].find(row=>row.dataset.fieldName===name);
 field('place').querySelector('input').value='내 장소';field('place').querySelector('[data-studio-action="field-lock"]').click();
 assert.equal(field('place').querySelector('input').disabled,true);
 field('place').querySelector('[data-studio-action="field-hide"]').click();assert.equal(field('place').hidden,true);
 assert.match(root.querySelector('.hidden-fields summary').textContent,/1개/);
 assert.equal(root.querySelector('.hidden-list small').textContent,'내 장소');
 root.querySelector('.back').click();root.querySelector('.script').click();assert.equal(field('place').hidden,true);
 const form=root.querySelector('form');form.reportValidity=()=>true;form.dispatchEvent(new window.Event('submit',{cancelable:true}));await tick();
 assert.equal(received.place,'내 장소');assert.equal(received.time,'09');
 assert.equal(field('place').querySelector('input').disabled,true,'The lock remains after a failed run');
 root.querySelector('.hidden-list .field-action').click();assert.equal(field('place').hidden,false);
 field('place').querySelector('[data-studio-action="field-lock"]').click();assert.equal(field('place').querySelector('input').disabled,false);
});

test('trusted launcher field clicks persist through the isolated bridge while synthetic clicks do not write',async()=>{
 const {ctx,window,document}=context();window.MacroStudio={features:{}};delete window.__macroStudioEntryInstalled;
 let state={ready:true,siteEnabled:true,archived:[],deleted:[],fieldPreferences:{}};const calls=[];
 ctx.CustomEvent=window.CustomEvent;ctx.MutationObserver=window.MutationObserver;
 ctx.chrome={runtime:{onMessage:{addListener(){}},getManifest:()=>({content_scripts:[{world:'MAIN',matches:['https://example.test/*']}]}),sendMessage:async message=>{
  calls.push(message);
  if(message.type==='scripts:field')state={...state,fieldPreferences:{task:{place:{type:'text',locked:message.action==='locked'&&message.enabled,hidden:message.action==='hidden'&&message.enabled,value:message.value}}}};
  return {ok:true,value:message.type==='local:connect'?{}:structuredClone(state)};
 }},storage:{onChanged:{addListener(){}}}};
 await load(ctx,'extension/ui/launcher.js');const app=window.MacroStudio.launcher.create();app.register({id:'task',name:'샘플',fields:[{name:'place',label:'장소',value:'기본'}],run:async()=>{}});
 await load(ctx,'extension/core/studio-entry.js');await tick();
 const host=document.getElementById('macro-studio-launcher'),root=host.shadowRoot;root.querySelector('.script').click();
 root.querySelector('[data-studio-action="field-lock"]').click();await tick();assert.equal(calls.filter(call=>call.type==='scripts:field').length,0);
 host.dispatchEvent(new window.CustomEvent('macro-studio:library-state',{detail:JSON.stringify(state)}));
 const input=root.querySelector('.fields input');input.value='확인한 값';input.checkValidity=()=>true;
 const button=root.querySelector('[data-studio-action="field-lock"]');const event=new window.Event('click',{cancelable:true});Object.defineProperty(event,'isTrusted',{value:true});event.composedPath=()=>[button,root,host,document,window];document.dispatchEvent(event);await tick();
 assert.equal(calls.filter(call=>call.type==='scripts:field').length,1);assert.equal(state.fieldPreferences.task.place.value,'확인한 값');
 assert.equal(root.querySelector('.fields input').disabled,true);
});

test('invalid required inputs cannot be locked or hidden, while persisted select settings restore the actual value',async()=>{
 const {ctx,window,document}=context();window.MacroStudio={features:{}};await load(ctx,'extension/ui/launcher.js');
 const app=window.MacroStudio.launcher.create();app.register({id:'task',name:'샘플',fields:[{name:'time',label:'시각',type:'select',value:'08',required:true,options:[{value:'08',label:'오전 8시'},{value:'10',label:'오전 10시'}]}],run:async()=>{}});
 app.applyLibraryState({ready:true,archived:[],deleted:[],fieldPreferences:{task:{time:{type:'select',locked:true,hidden:true,value:'10'}}}});
 const root=document.getElementById('macro-studio-launcher').shadowRoot;root.querySelector('.script').click();
 assert.equal(root.querySelector('select').value,'10');assert.equal(root.querySelector('select').disabled,true);assert.equal(root.querySelector('.field').hidden,true);
 root.querySelector('.hidden-list .field-action').click();root.querySelector('[data-studio-action="field-lock"]').click();
 const input=root.querySelector('select');input.checkValidity=()=>false;
 root.querySelector('[data-studio-action="field-hide"]').click();assert.equal(root.querySelector('.field').hidden,false);assert.equal(input.disabled,false);
 assert.match(root.querySelector('.field-feedback').textContent,/올바르게 입력/);
});

test('saving field settings and background refreshes preserve an open form and unsaved inputs; genuine OFF still closes it',async()=>{
 const {ctx,window,document}=context();window.MacroStudio={features:{}};delete window.__macroStudioEntryInstalled;
 let state={ready:true,siteEnabled:true,archived:[],deleted:[],fieldPreferences:{}},changed,hold=false,resolveState;
 const calls=[];
 ctx.CustomEvent=window.CustomEvent;ctx.MutationObserver=window.MutationObserver;
 ctx.chrome={runtime:{onMessage:{addListener(){}},getManifest:()=>({content_scripts:[{world:'MAIN',matches:['https://example.test/*']}]}),sendMessage:async message=>{
  calls.push(message.type);
  if(message.type==='local:connect')return {ok:true,value:{}};
  if(message.type==='scripts:field'){
   const before=state.fieldPreferences.task?.place||{locked:false,hidden:false};
   state={...state,fieldPreferences:{task:{place:{...before,type:'text',[message.action]:message.enabled,value:message.value}}}};
   changed({macroStudioFieldPreferences:{newValue:state.fieldPreferences}},'local');
  }
  if(message.type==='scripts:state'&&hold)return await new Promise(resolve=>{resolveState=resolve;});
  return {ok:true,value:structuredClone(state)};
 }},storage:{onChanged:{addListener:callback=>{changed=callback;}}}};
 await load(ctx,'extension/ui/launcher.js');const app=window.MacroStudio.launcher.create();
 app.register({id:'task',name:'샘플',fields:[{name:'place',label:'장소',value:'기본'},{name:'note',label:'메모',value:'원래 메모'}],run:async()=>{}});
 await load(ctx,'extension/core/studio-entry.js');await tick();
 const host=document.getElementById('macro-studio-launcher'),root=host.shadowRoot;
 root.querySelector('.orb').click();root.querySelector('.script').click();root.querySelector('input[name=note]').value='작성 중인 메모';
 const click=async selector=>{
  root.querySelector('input[name=place]').checkValidity=()=>true;
  const button=root.querySelector(selector),event=new window.Event('click',{cancelable:true});
  assert.ok(button);Object.defineProperty(event,'isTrusted',{value:true});event.composedPath=()=>[button,root,host,document,window];document.dispatchEvent(event);await tick();
  assert.equal(root.querySelector('.panel').hidden,false,'A storage notification must never close the execution form');
  assert.equal(root.querySelector('.config').hidden,false);
  assert.equal(root.querySelector('input[name=note]').value,'작성 중인 메모');
 };
 await click('[data-studio-action="field-lock"]');
 assert.equal(root.querySelector('input[name=place]').disabled,true);
 await click('.field[data-field-name=place] [data-studio-action="field-hide"]');
 assert.equal(root.querySelector('.field[data-field-name=place]').hidden,true);
 await click('.hidden-list .field-action');
 assert.equal(root.querySelector('.field[data-field-name=place]').hidden,false);
 assert.equal(root.querySelector('input[name=place]').disabled,true);
 await click('[data-studio-action="field-lock"]');
 assert.equal(root.querySelector('input[name=place]').disabled,false);
 assert.equal(calls.filter(type=>type==='local:connect').length,1,'Field preferences do not reconnect or replace script definitions');
 // A full script refresh can take time too. Retain the last acknowledged form.
 hold=true;changed({macroStudioLocalScripts:{oldValue:{revision:'old'},newValue:{revision:'new'}}},'local');await tick();
 assert.equal(root.querySelector('.panel').hidden,false);assert.equal(root.querySelector('input[name=note]').value,'작성 중인 메모');
 resolveState({ok:true,value:structuredClone(state)});await tick();hold=false;
 assert.equal(root.querySelector('.panel').hidden,false);
 root.querySelector('.close').click();changed({macroStudioFieldPreferences:{newValue:{}}},'local');await tick();
 assert.equal(root.querySelector('.panel').hidden,true,'Refreshing does not reopen a manually closed window');
 root.querySelector('.orb').click();root.querySelector('.script').click();
 state={...state,siteEnabled:false};changed({macroStudioSites:{newValue:{}}},'local');await tick();
 assert.equal(root.querySelector('.panel').hidden,true,'Confirmed site OFF still closes the window');
});

test('execution title rename saves only trusted actions, keeps drafts on failure and preserves execution inputs on success',async()=>{
 const {ctx,window,document}=context();window.MacroStudio={features:{}};delete window.__macroStudioEntryInstalled;
 let state={ready:true,siteEnabled:true,archived:[],deleted:[],fieldPreferences:{}},fail=false;const calls=[];
 ctx.CustomEvent=window.CustomEvent;ctx.MutationObserver=window.MutationObserver;
 ctx.chrome={runtime:{onMessage:{addListener(){}},getManifest:()=>({content_scripts:[{world:'MAIN',matches:['https://example.test/*']}]}),sendMessage:async message=>{
  calls.push(message);
  if(message.type==='scripts:rename')return fail?{ok:false,error:'폴더 쓰기 권한 필요'}:{ok:true,value:{...state,renamed:{id:message.id,name:message.name}}};
  return {ok:true,value:message.type==='local:connect'?{}:structuredClone(state)};
 }},storage:{onChanged:{addListener(){}}}};
 await load(ctx,'extension/ui/launcher.js');const app=window.MacroStudio.launcher.create();
 app.register({id:'task',name:'원래 이름',local:{id:'task',revision:'v1'},fields:[{name:'note',label:'메모',value:'기본'}],run:async()=>{}});
 await load(ctx,'extension/core/studio-entry.js');await tick();
 const host=document.getElementById('macro-studio-launcher'),root=host.shadowRoot;root.querySelector('.orb').click();root.querySelector('.script').click();
 root.querySelector('input[name=note]').value='실행 초안';root.querySelector('.rename-open').click();
 const name=root.querySelector('.macro-name');name.value='수정한 이름';
 assert.equal(root.querySelector('form').contains(name),false,'Name edits never enter the execution payload');
 root.querySelector('.rename-save').click();await tick();assert.equal(calls.some(call=>call.type==='scripts:rename'),false);
 root.querySelector('.rename-cancel').click();assert.equal(root.querySelector('.macro-name-editor').hidden,true);assert.equal(root.querySelector('.config h2').textContent,'원래 이름');
 root.querySelector('.rename-open').click();name.value='새 이름';
 const trusted=async(type,key)=>{const target=type==='click'?root.querySelector('.rename-save'):name,event=new window.Event(type,{cancelable:true});Object.defineProperty(event,'isTrusted',{value:true});if(key)Object.defineProperty(event,'key',{value:key});event.composedPath=()=>[target,root,host,document,window];document.dispatchEvent(event);await tick();};
 fail=true;await trusted('click');assert.equal(root.querySelector('.macro-name-editor').hidden,false);assert.equal(name.value,'새 이름');assert.match(root.querySelector('.name-feedback').textContent,/쓰기 권한/);
 fail=false;await trusted('keydown','Enter');
 assert.equal(root.querySelector('.macro-name-editor').hidden,true);assert.equal(root.querySelector('.config h2').textContent,'새 이름');
 assert.equal(root.querySelector('.panel').hidden,false);assert.equal(root.querySelector('input[name=note]').value,'실행 초안');
 assert.equal(root.querySelector('.script-copy strong').textContent,'새 이름');
});
