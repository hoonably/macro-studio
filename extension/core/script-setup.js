// The picker exposes a directory name, not its absolute OS path. The user confirms the path once.
export function normalizeFolderPath(value, folderName = '') {
  const path = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!path || path.length > 2000 || /[\u0000-\u001f<>]/.test(path) ||
      !/^(?:\/|[a-z]:\/)/i.test(path) || path.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('선택한 폴더의 전체 경로를 붙여넣으세요. 상대 경로나 ~ 경로는 사용할 수 없습니다.');
  }
  const name = path.split('/').at(-1);
  if (folderName && name.toLocaleLowerCase() !== folderName.toLocaleLowerCase()) {
    throw new Error('경로의 마지막 폴더 이름이 연결한 폴더(' + folderName + ')와 다릅니다.');
  }
  return path;
}
export function scriptsPath(folderPath, relativePath = []) {
  const root = normalizeFolderPath(folderPath);
  if (!Array.isArray(relativePath) || relativePath.some(part => !['local', 'scripts'].includes(part))) {
    throw new Error('연결한 스크립트 폴더 위치를 다시 확인하세요.');
  }
  return [root, ...relativePath].join('/');
}
export function folderReady(state) {
  if (!state?.connected || !state.readable || state.error) return false;
  try { normalizeFolderPath(state.folderPath, state.folderName); return true; } catch { return false; }
}
