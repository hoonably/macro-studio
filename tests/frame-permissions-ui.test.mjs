import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {context,code,tick} from './helpers.mjs';

async function notice({active=true}={}){
  let state={active,id:'recording-1',tabId:42,origins:['https://inside.test']},gesture=false,approve=false,changed;
  const calls=[];
  const chrome={runtime:{sendMessage:async message=>{
    calls.push(['message',structuredClone(message)]);
    if(message.type==='recording:permissions') return {ok:true,value:structuredClone(state)};
    if(message.type==='recording:stop'){state.active=false;return {ok:true};}
    throw new Error('Unexpected request');
  }},permissions:{request:async value=>{
    assert.equal(gesture,true,'Native permission requests must be inside the real button handler');
    calls.push(['permission',structuredClone(value)]);
    if(approve)state.origins=[];
    return approve;
  }},storage:{onChanged:{addListener:callback=>{changed=callback;}}}};
  const env=context(await code('extension/ui/frame-permissions.html'),{chrome,URLSearchParams,
    location:{search:'?recording=recording-1'}});
  env.window.close=()=>calls.push(['close']);
  vm.runInContext(await code('extension/ui/frame-permissions.js'),env.ctx);
  await tick();
  return {...env,calls,setApproval:value=>{approve=value;},setState:async next=>{state=next;changed({macroStudioRecording:{}},'session');await tick();},
    click:async selector=>{gesture=true;env.document.querySelector(selector).click();gesture=false;await tick();}};
}

test('an immediate recording notice names only its origins and requests permission only after a click; denial keeps the recording paused',async()=>{
  const env=await notice();
  assert.equal(env.document.querySelector('#origins').textContent,'https://inside.test');
  assert.equal(env.calls.some(call=>call[0]==='permission'),false);
  await env.click('#grant');
  assert.deepEqual(env.calls.find(call=>call[0]==='permission')[1],{origins:['https://inside.test/*']});
  assert.match(env.document.querySelector('#status').textContent,/기존 기록은 보존/);
  assert.equal(env.document.querySelector('#grant').disabled,false);
  assert.equal(env.calls.some(call=>call[0]==='close'),false);
  env.setApproval(true);await env.click('#grant');
  assert.equal(env.document.querySelector('#grant').disabled,true);
  assert.match(env.document.querySelector('#description').textContent,/기록을 이어갑니다/);
});

test('stale and stopped notices cannot grant access or stop another recording; refreshed labels are text only',async()=>{
  const env=await notice({active:false});
  assert.equal(env.document.querySelector('#grant').disabled,true);
  await env.click('#grant');assert.equal(env.calls.some(call=>call[0]==='permission'),false);
  await env.setState({active:true,id:'recording-1',origins:['https://inside.test/<b>text</b>']});
  assert.equal(env.document.querySelector('#origins b'),null);
  await env.click('#stop');
  assert.deepEqual(env.calls.find(call=>call[0]==='message'&&call[1].type==='recording:stop')[1],{type:'recording:stop',id:'recording-1'});
  assert.equal(env.calls.some(call=>call[0]==='close'),false,'The embedded notice must not close its browser window');
});
