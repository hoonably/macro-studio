export const LOCAL_KEY = 'macroStudioLocalScripts';
export const validId = id => typeof id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(id);
export function matchPattern(pattern) {
  if (typeof pattern !== 'string' || !/^https?:\/\/(?:\*\.)?[a-z0-9.-]+(?::\d+)?\/[^\s]*$/i.test(pattern)) throw new Error('구체적인 http(s) 사이트 범위가 필요합니다.');
  return pattern;
}
export const originPattern = pattern => matchPattern(pattern).replace(/^(https?:\/\/[^/]+)\/.*$/, '$1/*');
export function filePath(value) {
  if (typeof value !== 'string' || !value.endsWith('.js') || value.includes('\\') || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('스크립트 폴더 안의 .js 파일만 지정하세요.');
  return value;
}
export function scriptMetadata(value, id) {
  if (!validId(id) || value?.id !== id) throw new Error('스크립트 id와 폴더 이름을 확인하세요.');
  if (value.enabled === false) return { id, enabled: false, entries: [] };
  if (!Array.isArray(value.entries) || !value.entries.length || value.entries.length > 20) throw new Error('실행할 페이지 범위가 필요합니다.');
  return { id, name: String(value.name || id).slice(0, 100), enabled: true, entries: value.entries.map(entry => {
    if (!Array.isArray(entry.matches) || !entry.matches.length) throw new Error('사이트 범위가 없습니다.');
    const world = entry.world || 'ISOLATED', adapters = entry.adapters || ['dom'], files = entry.files || ['script.js'];
    if (!['ISOLATED', 'MAIN'].includes(world)) throw new Error('지원하지 않는 실행 world입니다.');
    if (!Array.isArray(adapters) || adapters.some(name => !['dom', 'sap'].includes(name))) throw new Error('지원하지 않는 어댑터입니다.');
    if (adapters.includes('sap') && world !== 'MAIN') throw new Error('SAP 어댑터는 MAIN world를 지정하세요.');
    if (!Array.isArray(files) || !files.length || files.length > 30) throw new Error('로드할 파일을 확인하세요.');
    return { matches: [...new Set(entry.matches.map(matchPattern))], world, adapters: [...new Set(adapters)], allFrames: !!entry.allFrames, files: files.map(filePath) };
  }) };
}
async function textFile(root, path, max = 512000) {
  const parts = path.split('/');
  let dir = root;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
  const file = await (await dir.getFileHandle(parts.at(-1))).getFile();
  if (file.size > max) throw new Error('파일이 너무 큽니다: ' + path);
  return file.text();
}
export async function scriptsDirectory(selected) {
  // Accept the repository or local/ as well, without scanning unrelated folders.
  let local;
  try { local = await selected.getDirectoryHandle('local'); } catch (error) { if (error.name !== 'NotFoundError') throw error; }
  if (local) return local.getDirectoryHandle('scripts');
  if (selected.name === 'local') return selected.getDirectoryHandle('scripts');
  if (selected.name !== 'scripts') {
    let found = false;
    for await (const handle of selected.values()) if (handle.kind === 'directory' && validId(handle.name)) {
      try { await handle.getFileHandle('script.json'); found = true; break; } catch (error) { if (error.name !== 'NotFoundError') throw error; }
    }
    if (!found) throw new Error('저장소 폴더 또는 local/scripts 폴더를 선택하세요.');
  }
  return selected;
}
export async function readScripts(directory, previous = []) {
  const scripts = [], errors = [], folders = [];
  for await (const handle of directory.values()) if (handle.kind === 'directory' && validId(handle.name)) folders.push(handle);
  if (folders.length > 200) throw new Error('스크립트 폴더는 200개까지 연결할 수 있습니다. local/scripts 폴더를 선택하세요.');
  let bytes = 0;
  for (const folder of folders.sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      const metadata = scriptMetadata(JSON.parse(await textFile(folder, 'script.json', 64000)), folder.name);
      if (!metadata.enabled) continue;
      const files = {};
      for (const path of new Set(metadata.entries.flatMap(entry => entry.files))) {
        files[path] = await textFile(folder, path); bytes += files[path].length * 2;
        if (bytes > 6000000) throw new Error('연결한 스크립트의 전체 용량이 너무 큽니다.');
      }
      scripts.push({ ...metadata, files });
    } catch (error) {
      const old = previous.find(script => script.id === folder.name);
      if (old) scripts.push(old);
      // A newly created folder may not contain script.json until the agent finishes saving.
      if (old || error.name !== 'NotFoundError') errors.push({ id: folder.name, message: String(error.message).slice(0, 250) });
    }
  }
  return { scripts, errors };
}
