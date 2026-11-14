import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldPreferences,changeFieldPreference} from '../extension/core/field-preferences.js';

test('field preferences retain explicit values for lock and hide, isolate macros, and discard values when both flags clear',()=>{
 const locked=changeFieldPreference({}, {id:'task',name:'place',type:'text',action:'locked',enabled:true,value:'기본 장소'});
 const hidden=changeFieldPreference(locked, {id:'task',name:'place',type:'text',action:'hidden',enabled:true,value:'기본 장소'});
 const next=changeFieldPreference(hidden, {id:'other',name:'place',type:'text',action:'locked',enabled:true,value:'다른 장소'});
 const unlocked=changeFieldPreference(next,{id:'task',name:'place',type:'text',action:'locked',enabled:false,value:'기본 장소'});
 assert.equal(unlocked.task.place.hidden,true);assert.equal(unlocked.other.place.value,'다른 장소');
 const visible=changeFieldPreference(unlocked,{id:'task',name:'place',type:'text',action:'hidden',enabled:false,value:'기본 장소'});
 assert.equal(visible.task,undefined);assert.equal(visible.other.place.locked,true);
 assert.equal(locked.task.place.hidden,false,'Existing state is never mutated');
});

test('stored preferences reject sensitive types, invalid names, oversized values and stale shapes',()=>{
 for (const patch of [{type:'password'},{type:'file'},{name:'__proto__'},{name:'constructor'},{value:'x'.repeat(2001)},{enabled:'yes'}])
  assert.throws(()=>changeFieldPreference({}, {id:'task',name:'date',type:'date',action:'hidden',enabled:true,value:'2026-11-14',...patch}));
 assert.deepEqual(fieldPreferences({task:{date:{type:'date',value:'2026-11-14',locked:true},secret:{type:'password',value:'hidden',hidden:true}}}),{task:{date:{type:'date',value:'2026-11-14',locked:true,hidden:false}}});
 const named=changeFieldPreference({}, {id:'constructor',name:'value',type:'text',action:'locked',enabled:true,value:'safe'});
 assert.equal(named.constructor.value.value,'safe');assert.equal(Object.prototype.value,undefined);
});
