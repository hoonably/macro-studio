import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {setupReady} from '../extension/core/script-setup.js';
import {context,code,tick} from './helpers.mjs';

async function navigation({embedded=false}={}){
  const calls=[],parent={postMessage:(...args)=>calls.push(['parent',...args])};
  const env=context('<html><body><a id="library" href="chrome-extension://studio/ui/library.html" target="_blank">보관함</a><a id="external" href="https://example.test" target="_blank">외부</a></body></html>',{
    URL,location:{href:'chrome-extension://studio/ui/studio.html'},
    chrome:{runtime:{getURL:path=>'chrome-extension://studio/'+path,sendMessage:async message=>{calls.push(['message',message]);return {ok:true};}},windows:{getCurrent:async()=>({id:7})}}
  });
  env.window.parent=embedded?parent:env.window;
  vm.runInContext(await code('extension/ui/panel-navigation.js'),env.ctx);await tick();
  return {...env,calls};
}

test('internal navigation always stays in the side panel, including links requesting a new tab and modifier/middle clicks',async()=>{
  const env=await navigation();
  for(const type of ['click','auxclick']){
    const event=new env.window.Event(type,{bubbles:true,cancelable:true});
    env.document.querySelector('#library').dispatchEvent(event);await tick();
    assert.equal(event.defaultPrevented,true);
  }
  assert.equal(env.calls.length,2);
  for(const [,message] of env.calls) assert.deepEqual(JSON.parse(JSON.stringify(message)),{type:'panel:open',page:'library',windowId:7});
  const external=new env.window.Event('click',{bubbles:true,cancelable:true});
  env.document.querySelector('#external').dispatchEvent(external);
  assert.equal(external.defaultPrevented,false,'External websites remain ordinary browser links');
});

test('embedded internal links navigate their existing host without reopening a window or requesting permissions',async()=>{
  const env=await navigation({embedded:true});
  env.document.querySelector('#library').click();await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(env.calls)),[['parent',{type:'macro-studio:panel-navigate',page:'library'},'chrome-extension://studio']]);
});

test('panel reuses page frames so switching views preserves drafts, validates message origin and displays permissions within the panel',async()=>{
  const calls=[];let changed,incoming;
  const env=context(await code('extension/ui/panel.html'),{URL,setupReady,chrome:{
    windows:{getCurrent:async()=>({id:7})},
    runtime:{id:'studio',getURL:path=>'chrome-extension://studio/'+path,onMessage:{addListener:fn=>{incoming=fn;}},sendMessage:async message=>{calls.push(message);return {ok:true,value:message.type==='local:status'?{connected:true,readable:true,writable:true,enabled:true,folderPath:'/Users/example/scripts',folderName:'scripts'}:null};}},
    storage:{local:{get:async()=>({macroStudioPanelRoutes:{7:'studio'}})},onChanged:{addListener:fn=>{changed=fn;}}}
  }});
  await vm.runInContext('(async()=>{'+(await code('extension/ui/panel.js')).replace(/^import[^\n]+\n/gm,'')+'})()',env.ctx);
  const studio=env.document.querySelector('#views iframe');
  const posted=[];
  const source={postMessage:message=>posted.push(message)};Object.defineProperty(studio,'contentWindow',{value:source});
  studio.draft='기록과 설명';
  const route=async(page)=>{changed({macroStudioPanelRoutes:{newValue:{7:page}}},'local');await tick();};
  await route('library');await route('studio');
  assert.equal(env.document.querySelector('#views iframe'),studio);assert.equal(studio.draft,'기록과 설명');
  assert.equal(env.document.querySelectorAll('#views iframe').length,2);
  await route('updates');
  studio.dispatchEvent(new env.window.Event('load'));
  assert.equal(env.document.querySelectorAll('#views iframe').length,2,'Updates reuse the existing studio');
  assert.equal(studio.hidden,false);
  assert.equal(studio.draft,'기록과 설명');
  assert.equal(posted.at(-1).type,'macro-studio:open-updates');
  const forged=new env.window.Event('message');Object.assign(forged,{origin:'https://example.test',source,data:{type:'macro-studio:panel-navigate',page:'reset'}});
  env.window.dispatchEvent(forged);assert.equal(env.document.querySelectorAll('#views iframe').length,2);
  let reply;
  incoming({type:'panel:permissions',windowId:7,recordingId:'recording-1'},{id:'studio'},value=>{reply=value;});
  assert.equal(reply.shown,true);assert.equal(env.document.querySelector('#permission-view').hidden,false);
  assert.match(env.document.querySelector('#permission-view iframe').src,/frame-permissions.html\?recording=recording-1$/);
  changed({macroStudioRecording:{newValue:{id:'recording-1',status:'recording',pendingFrameOrigins:[]}}},'session');
  assert.equal(env.document.querySelector('#permission-view').hidden,true);
  assert.equal(env.document.querySelector('#views iframe'),studio);
});

test('all main screens have only the creation and library navigation tabs',async()=>{
  for (const page of ['studio','library','scripts','privacy','reset']) {
    const env=context(await code('extension/ui/'+page+'.html'));
    const links=[...env.document.querySelectorAll('header nav a')];
    assert.deepEqual(links.map(link=>link.textContent),['만들기','내 매크로']);
    assert.equal(links.some(link=>link.getAttribute('href')==='scripts.html'),false);
  }
});

test('library entry checks preparation, resumes automatically after grants and preserves explicit path editing',async()=>{
  const state={connected:true,readable:true,writable:false,enabled:true,folderName:'scripts',folderPath:'/Users/example/scripts',missingOrigins:[]};
  let changed;const calls=[];
  const env=context(await code('extension/ui/panel.html'),{URL,setupReady,chrome:{
    windows:{getCurrent:async()=>({id:7})},
    runtime:{id:'studio',getURL:path=>'chrome-extension://studio/'+path,onMessage:{addListener(){}},sendMessage:async message=>{calls.push(message.type);return {ok:true,value:message.type==='local:status'?{...state}:null};}},
    storage:{local:{get:async()=>({macroStudioPanelRoutes:{7:'library'}})},onChanged:{addListener:fn=>{changed=fn;}}}
  }});
  await vm.runInContext('(async()=>{'+(await code('extension/ui/panel.js')).replace(/^import[^\n]+\n/gm,'')+'})()',env.ctx);
  const setup=env.document.querySelector('#views iframe');assert.equal(setup.src,'scripts.html');
  const source={postMessage(){}};Object.defineProperty(setup,'contentWindow',{value:source});
  const post=async(type,extra={})=>{const event=new env.window.Event('message');Object.assign(event,{origin:'chrome-extension://studio',source,data:{type,...extra}});env.window.dispatchEvent(event);await tick();};
  await post('macro-studio:setup-ready');
  assert.equal(env.document.querySelectorAll('#views iframe').length,1,'A readiness event cannot bypass the actual permission check');
  state.writable=true;await post('macro-studio:setup-ready');
  const library=env.document.querySelector('iframe[src="library.html"]');assert.ok(library);assert.equal(library.hidden,false);
  state.writable=false;changed({macroStudioLocalScripts:{newValue:{}}},'local');await tick();
  assert.equal(library.hidden,true);assert.equal(setup.hidden,false);
  state.writable=true;await post('macro-studio:setup-ready');
  assert.equal(library.hidden,false);
  await post('macro-studio:panel-navigate',{page:'scripts'});
  assert.equal(setup.hidden,false);
  await post('macro-studio:setup-ready');assert.equal(setup.hidden,false,'Opening path settings does not immediately navigate away');
  await post('macro-studio:setup-continue');assert.equal(library.hidden,false);
  assert.equal(calls.some(type=>/Permission|picker/.test(type)),false,'Navigation only queries; a real setup button grants access');
});
