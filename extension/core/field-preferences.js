export const FIELD_PREFERENCES_KEY = 'macroStudioFieldPreferences';
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;
const fieldPattern = /^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/;
const types = new Set(['text','select','date','time','number','email','url','tel','search','datetime-local']);
const validField = name => typeof name === 'string' && fieldPattern.test(name) && !['constructor','prototype','__proto__'].includes(name);
export function fieldPreferences(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [id, fields] of Object.entries(value).slice(0, 100)) {
    if (!idPattern.test(id) || !fields || typeof fields !== 'object' || Array.isArray(fields)) continue;
    const next = {};
    for (const [name, item] of Object.entries(fields).slice(0, 60)) {
      if (!validField(name) || !item || !types.has(item.type) || typeof item.value !== 'string' || item.value.length > 2000 || (item.locked !== true && item.hidden !== true)) continue;
      next[name] = { type:item.type, locked:item.locked === true, hidden:item.hidden === true, value:item.value };
    }
    if (Object.keys(next).length) result[id] = next;
  }
  return result;
}
export function changeFieldPreference(previous, { id, name, type, action, enabled, value }) {
  if (!idPattern.test(id) || !validField(name) || !types.has(type) || !['locked','hidden'].includes(action) || typeof enabled !== 'boolean' || typeof value !== 'string' || value.length > 2000)
    throw new Error('입력 설정을 저장할 수 없습니다. 항목과 값을 확인하세요.');
  const result = fieldPreferences(previous), fields = Object.hasOwn(result,id) ? result[id] : {};
  const before = fields[name]?.type === type ? fields[name] : {locked:false,hidden:false};
  const next = {...before,type,[action]:enabled,value};
  if (next.locked || next.hidden) fields[name] = next; else delete fields[name];
  if (Object.keys(fields).length > 60) throw new Error('매크로의 입력 설정은 60개까지 저장할 수 있습니다.');
  if (Object.keys(fields).length) result[id] = fields; else delete result[id];
  if (Object.keys(result).length > 100 || JSON.stringify(result).length > 1000000) throw new Error('저장한 입력 설정이 너무 많습니다. 사용하지 않는 잠금·숨김을 해제하세요.');
  return result;
}
