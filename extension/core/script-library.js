export const LIBRARY_KEY = 'macroStudioScriptLibrary';

export function libraryState(value) {
  const ids = items => [...new Set(Array.isArray(items) ? items.filter(id =>
    typeof id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(id)) : [])];
  const deleted = ids(value?.deleted);
  return { archived: ids(value?.archived).filter(id => !deleted.includes(id)), deleted };
}

export function matchesSite(pattern, value) {
  try {
    const url = new URL(value), parts = pattern.match(/^(https?):\/\/([^/]+)(\/.*)$/);
    if (!parts || url.protocol !== parts[1] + ':') return false;
    const host = parts[2];
    if (host.startsWith('*.')) {
      if (url.host !== host.slice(2) && !url.host.endsWith('.' + host.slice(2))) return false;
    } else if (url.host !== host) return false;
    const expression = '^' + parts[3].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
    return new RegExp(expression).test(url.pathname + url.search);
  } catch { return false; }
}

export function changeLibrary(value, action, id) {
  const state = libraryState(value);
  if (state.deleted.includes(id)) throw new Error('보관함에서 이미 삭제한 스크립트입니다.');
  if (action === 'archive') {
    if (!state.archived.includes(id)) state.archived.push(id);
  } else if (action === 'restore') state.archived = state.archived.filter(item => item !== id);
  else if (action === 'delete') {
    if (!state.archived.includes(id)) throw new Error('먼저 보관함으로 옮긴 뒤 삭제하세요.');
    state.archived = state.archived.filter(item => item !== id);
    state.deleted.push(id);
  } else throw new Error('지원하지 않는 스크립트 작업입니다.');
  return state;
}
