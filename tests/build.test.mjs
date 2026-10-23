import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build, projectRoot, validateMatch } from '../tools/build.mjs';
import { newScript } from '../tools/new-script.mjs';

test('public build excludes private configuration and scripts; personal build registers scoped scripts', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'macro-studio-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const dir of ['extension', 'profiles', 'scripts', 'templates']) await fs.cp(path.join(projectRoot, dir), path.join(root, dir), { recursive: true });
  await fs.mkdir(path.join(root, 'local/profiles'), { recursive: true });
  await fs.writeFile(path.join(root, 'local/profiles/unist-travel.json'), JSON.stringify({ purpose: 'PRIVATE_SENTINEL' }));
  const script = await newScript({ root, id: 'weekly-task', name: 'Test $& name', url: 'https://example.test/form' });
  assert.ok((await fs.readFile(path.join(script, 'script.js'), 'utf8')).includes('Test $& name'));
  await assert.rejects(newScript({ root, id: 'weekly-task', url: 'https://example.test' }), /EEXIST/);
  await assert.rejects(newScript({ root, id: '../escape', url: 'https://example.test' }), /id/);
  await assert.rejects(newScript({ root, id: 'bad-site', url: 'file:///private' }), /http/);
  const personal = await build({ root });
  assert.equal(personal.personal, true);
  assert.ok((await fs.readFile(path.join(personal.output, 'core/config.js'), 'utf8')).includes('PRIVATE_SENTINEL'));
  assert.ok(personal.manifest.content_scripts.some(entry => entry.js.includes('scripts/local/weekly-task/script.js')));
  const shared = await build({ root, publicOnly: true });
  assert.equal(shared.personal, false);
  assert.ok(!(await fs.readFile(path.join(shared.output, 'core/config.js'), 'utf8')).includes('PRIVATE_SENTINEL'));
  assert.ok(!shared.manifest.content_scripts.some(entry => entry.js.some(file => file.includes('/local/'))));
  await assert.rejects(fs.access(path.join(shared.output, 'scripts/local')));
  // A public build must not even parse a private file.
  await fs.writeFile(path.join(root, 'local/profiles/unist-travel.json'), 'not JSON');
  await build({ root, publicOnly: true });
  await fs.writeFile(path.join(root, 'local/profiles/unist-travel.json'), '{}');
  const metadata = path.join(script, 'script.json');
  const malicious = JSON.parse(await fs.readFile(metadata, 'utf8')); malicious.entries[0].files = ['../../../outside.js'];
  await fs.writeFile(metadata, JSON.stringify(malicious));
  await assert.rejects(build({ root }), /ファイル|파일/);
  assert.throws(() => validateMatch('<all_urls>'), /사이트 범위/);
});
