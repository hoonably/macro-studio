import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build, projectRoot } from './build.mjs';

const { output, manifest } = await build({ storeOnly: true });
const target = path.join(projectRoot, 'artifacts', 'macro-studio-' + manifest.version + '-chrome-store.zip');
await fs.mkdir(path.dirname(target), { recursive: true });
await fs.rm(target, { force: true });
async function list(directory, prefix = '') {
  const files = [];
  for (const item of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if (item.isDirectory()) files.push(...await list(path.join(directory, item.name), prefix + item.name + '/'));
    else if (item.isFile() && !item.name.startsWith('.')) files.push(prefix + item.name);
  }
  return files;
}
const files = await list(output);
if (!files.includes('manifest.json') || files.some(file => file.startsWith('scripts/local/'))) throw new Error('웹 스토어 패키지 범위를 확인하세요.');
execFileSync('zip', ['-X', '-q', target, '-@'], { cwd: output, input: files.join('\n') + '\n' });
execFileSync('unzip', ['-tq', target]);
console.log('Chrome Web Store package: ' + target);
