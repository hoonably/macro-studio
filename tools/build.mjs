import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const readJSON = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const exists = async file => !!(await fs.stat(file).catch(() => null));
const sourceOnly = source => !['.gallery', '.DS_Store'].includes(path.basename(source));
const validId = id => typeof id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(id);
export function validateMatch(pattern) {
  if (typeof pattern !== 'string' || !/^https?:\/\/(?:\*\.)?[a-z0-9.-]+(?::\d+)?\/[^\s]*$/i.test(pattern)) {
    throw new Error('사이트 범위를 구체적인 http(s) 호스트로 지정하세요: ' + pattern);
  }
  return pattern;
}
function safeFile(file) {
  if (typeof file !== 'string' || !file || file.includes('\\') || path.posix.isAbsolute(file) ||
      file.split('/').some(part => part === '..' || part === '.' || !part)) throw new Error('잘못된 파일 경로: ' + file);
  return file;
}
async function folders(directory) {
  return (await fs.readdir(directory, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  })).filter(entry => entry.isDirectory() && sourceOnly(entry.name)).map(entry => entry.name).sort();
}

export async function build({ root = projectRoot, publicOnly = false } = {}) {
  const manifest = await readJSON(path.join(root, 'extension/manifest.base.json'));
  const profile = await readJSON(path.join(root, 'profiles/unist.json'));
  const content = profile.entries.map(entry => ({
    matches: entry.matches.map(validateMatch),
    js: entry.files.map(safeFile),
    world: entry.world, all_frames: !!entry.allFrames, run_at: 'document_idle'
  }));
  const catalog = [{ id: profile.scriptId, name: profile.scriptName,
    matches: [...new Set(content.flatMap(entry => entry.matches))] }];
  if (!validId(profile.scriptId)) throw new Error('사이트 프로필의 스크립트 id를 확인하세요.');
  const localScripts = [];
  // A fresh clone must be connectable before the user creates their first script.
  if (!publicOnly) await fs.mkdir(path.join(root, 'local/scripts'), { recursive: true });
  if (!publicOnly) for (const id of await folders(path.join(root, 'local/scripts'))) {
    if (!validId(id)) throw new Error('잘못된 개인 스크립트 폴더: ' + id);
    const folder = path.join(root, 'local/scripts', id);
    const metadata = await readJSON(path.join(folder, 'script.json'));
    if (metadata.id !== id) throw new Error('스크립트 id와 폴더 이름이 다릅니다: ' + id);
    if (metadata.enabled === false) continue;
    if (catalog.some(script => script.id === id)) throw new Error('중복된 스크립트 id: ' + id);
    catalog.push({ id, name: String(metadata.name || id), bundled: true,
      matches: [...new Set((metadata.entries || []).flatMap(entry => entry.matches || []).map(validateMatch))] });
    for (const entry of metadata.entries || []) {
      if (!['MAIN', 'ISOLATED'].includes(entry.world || 'ISOLATED')) throw new Error('지원하지 않는 실행 world');
      const adapters = entry.adapters || ['dom'];
      if (!Array.isArray(adapters) || adapters.some(name => !['dom', 'sap'].includes(name))) throw new Error('지원하지 않는 어댑터');
      const files = (entry.files || ['script.js']).map(safeFile);
      if (!entry.matches?.length) throw new Error('사이트 범위가 없습니다: ' + id);
      content.push({
        matches: entry.matches.map(validateMatch),
        js: ['core/namespace.js', ...adapters.map(name => 'adapters/' + name + '.js'), 'ui/launcher.js', ...files.map(file => 'scripts/local/' + id + '/' + file)],
        world: entry.world || 'ISOLATED', all_frames: !!entry.allFrames, run_at: 'document_idle'
      });
      for (const file of files) {
        const source = path.join(folder, file);
        const real = await fs.realpath(source);
        if (!real.startsWith((await fs.realpath(folder)) + path.sep)) throw new Error('폴더 밖 파일은 포함할 수 없습니다.');
        localScripts.push({ source, target: 'scripts/local/' + id + '/' + file });
      }
    }
  }
  const origins = [...new Set([...profile.origins, ...content.flatMap(entry => entry.matches.map(pattern => {
    const match = pattern.match(/^(https?:\/\/[^/]+)\//);
    return match[1] + '/*';
  }))])];
  manifest.host_permissions = origins;
  // Privileged recording stays in the extension's isolated world.
  const bridgeFiles = ['core/namespace.js', 'ui/launcher.js', 'core/studio-entry.js', 'recorder/capture.js'];
  manifest.content_scripts = [...content, { matches: origins, js: bridgeFiles,
    world: 'ISOLATED', all_frames: true, run_at: 'document_idle' }];
  let personal = null;
  const privateFile = path.join(root, 'local/profiles/unist-travel.json');
  if (!publicOnly && await exists(privateFile)) personal = await readJSON(privateFile);
  if (personal?.name) catalog[0].name = String(personal.name);
  const output = path.join(root, publicOnly ? 'dist-public' : 'dist');
  const staging = output + '.building';
  await fs.rm(staging, { force: true, recursive: true });
  try {
    await fs.cp(path.join(root, 'extension'), staging, { recursive: true, filter: sourceOnly });
    await fs.rm(path.join(staging, 'manifest.base.json'));
    await fs.cp(path.join(root, 'scripts/examples'), path.join(staging, 'scripts/examples'), { recursive: true, filter: sourceOnly });
    for (const file of localScripts) {
      const target = path.join(staging, file.target);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(file.source, target);
    }
    await fs.writeFile(path.join(staging, 'core/config.js'), '"use strict";\nwindow.MacroStudio.config = Object.freeze(' +
      JSON.stringify({ unistTravel: personal }) + ');\n');
    await fs.writeFile(path.join(staging, 'core/script-catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
    await fs.writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    for (const entry of manifest.content_scripts) for (const file of entry.js) {
      if (!await exists(path.join(staging, safeFile(file)))) throw new Error('등록 파일이 없습니다: ' + file);
    }
    for (const file of ['background.js', 'core/script-library.js', 'core/site-settings.js', 'core/script-catalog.json', 'ui/studio.html',
      manifest.action.default_popup, 'ui/popup.js', 'ui/popup.css',
      'ui/library.html', 'ui/library.js', 'ui/library.css', 'ui/scripts.html', 'ui/scripts.js', 'scripts/runtime.js', ...Object.values(manifest.icons)]) {
      if (!await exists(path.join(staging, file))) throw new Error('확장 파일이 없습니다: ' + file);
    }
    await fs.rm(output, { recursive: true, force: true });
    await fs.rename(staging, output);
  } catch (error) {
    await fs.rm(staging, { force: true, recursive: true });
    throw error;
  }
  return { output, manifest, personal: !!personal, scripts: localScripts.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await build({ publicOnly: process.argv.includes('--public') });
  console.log('Built ' + result.output + (result.personal ? ' (개인 설정 포함 · 공유 금지)' : ' (공개 예제)'));
}
