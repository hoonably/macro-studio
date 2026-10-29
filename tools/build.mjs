import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

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
async function fingerprint(directory, prefix = '') {
  const hash = createHash('sha256');
  async function add(folder, relative) {
    for (const entry of (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const name = relative + entry.name, file = path.join(folder, entry.name);
      if (entry.isDirectory()) await add(file, name + '/');
      else if (entry.isFile()) {
        const bytes = await fs.readFile(file);
        hash.update(JSON.stringify([name, bytes.length]) + '\n'); hash.update(bytes);
      }
    }
  }
  await add(directory, prefix);
  return hash.digest('hex');
}

export async function build({ root = projectRoot, publicOnly = false, storeOnly = false } = {}) {
  if (storeOnly) publicOnly = true;
  const manifest = await readJSON(path.join(root, 'extension/manifest.base.json'));
  if (storeOnly) manifest.minimum_chrome_version = '138';
  // Examples are reference source, never preinstalled scripts or site permissions.
  const content = [], catalog = [];
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
  const origins = [...new Set(content.flatMap(entry => entry.matches.map(pattern => {
    const match = pattern.match(/^(https?:\/\/[^/]+)\//);
    return match[1] + '/*';
  })))];
  manifest.host_permissions = origins;
  // Privileged recording stays in the extension's isolated world.
  const bridgeFiles = ['core/namespace.js', 'ui/launcher.js', 'core/studio-entry.js', 'recorder/capture.js'];
  if (origins.length) manifest.content_scripts = [...content, { matches: origins, js: bridgeFiles,
    world: 'ISOLATED', all_frames: true, run_at: 'document_idle' }];
  const output = path.join(root, storeOnly ? 'dist-store' : publicOnly ? 'dist-public' : 'dist');
  const staging = output + '.building';
  await fs.rm(staging, { force: true, recursive: true });
  try {
    await fs.cp(path.join(root, 'extension'), staging, { recursive: true, filter: sourceOnly });
    await fs.rm(path.join(staging, 'manifest.base.json'));
    if (storeOnly) {
      await fs.writeFile(path.join(staging, 'core/distribution.js'), 'export const STORE_BUILD = true;\n');
      for (const page of ['studio', 'scripts']) {
        const file = path.join(staging, 'ui', page + '.html');
        let html = await fs.readFile(file, 'utf8');
        html = html.replace(/Git으로 설치했다면 <strong>macro-studio 폴더 자체를 선택하세요\.<\/strong> (?:내부의|그 안의) <code>local\/scripts<\/code>를 자동으로 찾아 연결합니다\./, '원하는 위치에 <strong>scripts 폴더를 만들고 선택하세요.</strong> 에이전트가 만든 개인 스크립트를 이 폴더에 저장하면 자동 반영됩니다.');
        html = html.replace(/저장소 바로 아래의 <code>scripts<\/code>는 개발용 예제 폴더입니다\. 개인 스크립트는 <code>local\/scripts<\/code>에 저장하세요\./, '처음에는 폴더 연결 없이 작업을 기록해도 됩니다. 개인 스크립트를 실행할 때 폴더를 연결하세요. Git·npm 설치는 필요하지 않습니다.');
        html = html.replace('Codex 또는 Claude Code에서 이 저장소를 열고 프롬프트를 붙여 넣으세요.', '개인 스크립트를 저장할 폴더를 코딩 에이전트에서 열고 프롬프트를 붙여 넣으세요.');
        html = html.replace('<button id="reload-extension" class="text-button">확장 기능 업데이트 적용</button>', '<button id="reload-extension" class="text-button" hidden>확장 다시 시작</button>');
        html = html.replace('스크립트와 확장 업데이트를 자동으로 반영합니다.', '개인 스크립트 파일을 자동으로 반영합니다.');
        await fs.writeFile(file, html);
      }
    }
    for (const file of localScripts) {
      const target = path.join(staging, file.target);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(file.source, target);
    }
    await fs.writeFile(path.join(staging, 'core/config.js'), '"use strict";\nwindow.MacroStudio.config = Object.freeze(' +
      JSON.stringify({}) + ');\n');
    await fs.writeFile(path.join(staging, 'core/script-catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
    await fs.writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    for (const entry of manifest.content_scripts || []) for (const file of entry.js) {
      if (!await exists(path.join(staging, safeFile(file)))) throw new Error('등록 파일이 없습니다: ' + file);
    }
    for (const file of ['background.js', 'core/script-library.js', 'core/site-settings.js', 'core/script-catalog.json', 'ui/studio.html',
      manifest.action.default_popup, 'ui/popup.js', 'ui/popup.css',
      'ui/library.html', 'ui/library.js', 'ui/library.css', 'ui/scripts.html', 'ui/scripts.js', 'scripts/runtime.js', ...Object.values(manifest.icons)]) {
      if (!await exists(path.join(staging, file))) throw new Error('확장 파일이 없습니다: ' + file);
    }
    const id = await fingerprint(staging);
    const workerFile = path.join(staging, 'background.js');
    await fs.writeFile(workerFile, (await fs.readFile(workerFile, 'utf8')).replace('__MACRO_STUDIO_BUILD_ID__', id));
    await fs.writeFile(path.join(staging, 'core/build-info.json'), JSON.stringify({ id }) + '\n');
    // Identical builds keep the same marker and do not cause a reload loop.
    const previous = await readJSON(path.join(output, 'core/build-info.json')).catch(() => null);
    if (previous?.id === id) {
      await fs.rm(staging, { recursive: true });
      return { output, manifest, personal: catalog.length > 0, scripts: catalog.length };
    }
    await fs.rm(output, { recursive: true, force: true });
    await fs.rename(staging, output);
  } catch (error) {
    await fs.rm(staging, { force: true, recursive: true });
    throw error;
  }
  return { output, manifest, personal: catalog.length > 0, scripts: catalog.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await build({ publicOnly: process.argv.includes('--public'), storeOnly: process.argv.includes('--store') });
  console.log('Built ' + result.output + (result.personal ? ' (개인 스크립트 포함 · 공유 금지)' : ' (스크립트 없는 기본 설치)'));
}
