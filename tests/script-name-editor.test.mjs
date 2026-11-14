import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {context,code,tick} from './helpers.mjs';

test('name editor supports cancel, validation, async save and recoverable errors without interpreting HTML',async()=>{
  const env=context();
  vm.runInContext((await code('extension/ui/script-name-editor.js')).replace('export function','function')+';globalThis.scriptName=scriptName;',env.ctx);
  let resolve, fail=false;const names=[];
  const row=env.ctx.scriptName({name:'<img src=x> 원본'}, async name=>{names.push(name);await new Promise(done=>{resolve=done;});if(fail)throw Error('저장 실패');});
  env.document.body.append(row);
  assert.equal(row.querySelector('img'),null);
  row.querySelector('.name-edit').click();row.querySelector('input').value='수정 초안';row.querySelector('.name-cancel').click();
  assert.equal(names.length,0);assert.equal(row.querySelector('strong').textContent,'<img src=x> 원본');
  row.querySelector('.name-edit').click();const input=row.querySelector('input');
  input.value=' ';row.querySelector('.name-save').click();await tick();
  assert.match(row.querySelector('.name-error').textContent,/1–100/);assert.equal(names.length,0);
  input.value='새 이름';fail=true;row.querySelector('.name-save').click();await tick();
  assert.equal(input.disabled,true);assert.equal(row.querySelector('strong').textContent,'<img src=x> 원본');
  resolve();await tick();assert.match(row.querySelector('.name-error').textContent,/저장 실패/);assert.equal(input.disabled,false);
  fail=false;row.querySelector('.name-save').click();await tick();resolve();await tick();
  assert.equal(row.querySelector('input'),null);assert.equal(row.querySelector('strong').textContent,'새 이름');
});
