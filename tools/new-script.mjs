import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRoot } from './build.mjs';

export async function newScript({ root = projectRoot, id, name, url }) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id || '')) throw new Error('id는 영문 소문자로 시작하고 소문자·숫자·하이픈만 사용하세요.');
  const site = new URL(url);
  if (!['http:', 'https:'].includes(site.protocol) || site.username || site.password) throw new Error('일반 http(s) 사이트 주소를 입력하세요.');
  const destination = path.join(root, 'local/scripts', id);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.mkdir(destination); // Never replace an existing personal script.
  const template = await fs.readFile(path.join(root, 'templates/script/script.js'), 'utf8');
  const code = template.replace('__SCRIPT_ID__', () => JSON.stringify(id)).replace('__SCRIPT_NAME__', () => JSON.stringify(name || id));
  await fs.writeFile(path.join(destination, 'script.js'), code);
  await fs.writeFile(path.join(destination, 'script.json'), JSON.stringify({
    id, name: name || id, enabled: true,
    entries: [{ matches: [site.origin + '/*'], world: 'ISOLATED', adapters: ['dom'], files: ['script.js'] }]
  }, null, 2) + '\n');
  return destination;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = flag => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
  if (!args[0] || !option('--url')) {
    console.log('사용법: npm run new:script -- my-task --name "내 작업" --url https://example.com');
    process.exitCode = 1;
  } else console.log('Created ' + await newScript({ id: args[0], name: option('--name'), url: option('--url') }));
}
