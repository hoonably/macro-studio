import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { projectRoot } from './build.mjs';

const skip = new Set(['.git', 'node_modules', 'local', 'dist', 'dist-public', 'dist-store', 'artifacts']);
async function walk(directory) {
  const files = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    if (skip.has(item.name) || item.name.endsWith('.building')) continue;
    const file = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await walk(file));
    else if (item.isFile()) files.push(file);
  }
  return files;
}
const files = await walk(projectRoot);
for (const file of files.filter(file => /\.(?:m?js)$/.test(file))) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
let privateConfig;
try { privateConfig = JSON.parse(await fs.readFile(path.join(projectRoot, 'local/profiles/unist-travel.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (privateConfig) {
  const values = ['name', 'purpose', 'memo', 'approvalLine', 'organization'].map(key => privateConfig[key])
    .concat(privateConfig.approvers || []).filter(value => typeof value === 'string' && value.length >= 2);
  for (const file of files.filter(file => /\.(?:m?js|json|md|txt|yml)$/.test(file))) {
    const content = await fs.readFile(file, 'utf8');
    if (values.some(value => content.includes(value))) throw new Error('개인 설정값이 공개 소스에 들어 있습니다: ' + path.relative(projectRoot, file));
  }
}
for (const file of files.filter(file => file.endsWith('.md'))) {
  const content = await fs.readFile(file, 'utf8');
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(?:https?:|#)/.test(match[1])) continue;
    const target = path.resolve(path.dirname(file), match[1].split('#')[0]);
    await fs.access(target).catch(() => { throw new Error('문서 링크가 없습니다: ' + path.relative(projectRoot, file) + ' → ' + match[1]); });
  }
}
console.log('Checked JavaScript syntax, documentation links, and separation of personal preset values.');
