import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build, projectRoot, validateMatch } from '../tools/build.mjs';
import { newScript } from '../tools/new-script.mjs';
import { scriptsDirectory, readScripts } from '../extension/scripts/directory.js';

test('a fresh personal build prepares an empty connectable script folder; public builds do not touch local', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'macro-studio-first-run-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const dir of ['extension', 'profiles', 'scripts']) await fs.cp(path.join(projectRoot, dir), path.join(root, dir), { recursive: true });
  await fs.mkdir(path.join(root, 'extension/.gallery'), { recursive: true });
  await fs.writeFile(path.join(root, 'extension/.gallery/gallery.csv'), 'PRIVATE_LOCAL_METADATA');
  const shared = await build({ root, publicOnly: true });
  await assert.rejects(fs.access(path.join(root, 'local')));
  await assert.rejects(fs.access(path.join(root, 'dist-public/.gallery')));
  const result = await build({ root });
  for (const built of [shared, result]) {
    const stamp = JSON.parse(await fs.readFile(path.join(built.output, 'core/build-info.json'), 'utf8'));
    assert.match(stamp.id, /^[a-f0-9]{64}$/);
    assert.ok((await fs.readFile(path.join(built.output, 'background.js'), 'utf8')).includes(stamp.id));
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(built.output, 'core/script-catalog.json'), 'utf8')), []);
    assert.deepEqual(built.manifest.host_permissions, []);
    assert.equal(built.manifest.content_scripts, undefined, 'No scripts or empty match registrations on a fresh install');
    await assert.rejects(fs.access(path.join(built.output, 'scripts/examples')));
  }
  assert.equal(result.personal, false);
  assert.equal(result.scripts, 0);
  await assert.rejects(fs.access(path.join(root, 'dist/.gallery')));
  assert.deepEqual(await fs.readdir(path.join(root, 'local/scripts')), []);
  const directory = file => ({ kind: 'directory', name: path.basename(file),
    getDirectoryHandle: async name => { await fs.access(path.join(file, name)); return directory(path.join(file, name)); },
    async *values() { for (const name of await fs.readdir(file)) yield directory(path.join(file, name)); }
  });
  assert.deepEqual(await readScripts(await scriptsDirectory(directory(root))), { scripts: [], errors: [] });
  const firstBuild = await fs.readFile(path.join(root, 'dist/core/build-info.json'), 'utf8');
  await build({ root });
  assert.equal(await fs.readFile(path.join(root, 'dist/core/build-info.json'), 'utf8'), firstBuild, 'Identical builds do not trigger updates');
  await fs.appendFile(path.join(root, 'extension/ui/studio.html'), '\n<!-- New UI -->');
  await build({ root });
  assert.notEqual(await fs.readFile(path.join(root, 'dist/core/build-info.json'), 'utf8'), firstBuild, 'UI-only changes are detected without a version bump');
  await fs.mkdir(path.join(root, 'local/scripts/.gallery'));
  await fs.writeFile(path.join(root, 'local/scripts/.gallery/gallery.csv'), 'PRIVATE_LOCAL_METADATA');
  assert.equal((await build({ root })).scripts, 0, 'Local gallery indexes are not script folders');
});

test('builds ignore legacy presets and examples; only explicit personal scripts are bundled', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'macro-studio-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const dir of ['extension', 'profiles', 'scripts', 'templates']) await fs.cp(path.join(projectRoot, dir), path.join(root, dir), { recursive: true });
  await fs.mkdir(path.join(root, 'local/profiles'), { recursive: true });
  await fs.writeFile(path.join(root, 'local/profiles/unist-travel.json'), JSON.stringify({ purpose: 'PRIVATE_SENTINEL', name: 'PRIVATE_NAME_SENTINEL' }));
  const script = await newScript({ root, id: 'weekly-task', name: 'Test $& name', url: 'https://example.test/form' });
  assert.ok((await fs.readFile(path.join(script, 'script.js'), 'utf8')).includes('Test $& name'));
  await assert.rejects(newScript({ root, id: 'weekly-task', url: 'https://example.test' }), /EEXIST/);
  await assert.rejects(newScript({ root, id: '../escape', url: 'https://example.test' }), /id/);
  await assert.rejects(newScript({ root, id: 'bad-site', url: 'file:///private' }), /http/);
  const personal = await build({ root });
  assert.equal(personal.personal, true);
  assert.ok(!(await fs.readFile(path.join(personal.output, 'core/config.js'), 'utf8')).includes('PRIVATE_SENTINEL'));
  assert.ok(personal.manifest.content_scripts.some(entry => entry.js.includes('scripts/local/weekly-task/script.js')));
  const catalog = JSON.parse(await fs.readFile(path.join(personal.output, 'core/script-catalog.json'), 'utf8'));
  assert.deepEqual(catalog.map(script => script.id), ['weekly-task']);
  assert.deepEqual(catalog.find(script => script.id === 'weekly-task').matches, ['https://example.test/*']);
  await fs.access(path.join(personal.output, 'ui/library.html'));
  assert.equal(personal.manifest.action.default_popup, 'ui/popup.html');
  await fs.access(path.join(personal.output, personal.manifest.action.default_popup));
  const shared = await build({ root, publicOnly: true });
  assert.equal(shared.personal, false);
  const store = await build({ root, storeOnly: true });
  assert.equal(store.manifest.minimum_chrome_version, '138');
  assert.equal(store.personal, false);
  assert.deepEqual(store.manifest.host_permissions, []);
  assert.equal(store.manifest.content_scripts, undefined);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(store.output, 'core/script-catalog.json'), 'utf8')), []);
  await assert.rejects(fs.access(path.join(store.output, 'scripts/local')));
  assert.match(await fs.readFile(path.join(store.output, 'core/distribution.js'), 'utf8'), /STORE_BUILD = true/);
  for (const page of ['studio', 'scripts']) {
    const html = await fs.readFile(path.join(store.output, 'ui', page + '.html'), 'utf8');
    assert.match(html, /scripts 폴더를 만들고 선택/);
    assert.doesNotMatch(html, /macro-studio 폴더 자체|local\/scripts|이 저장소를 열고/);
    assert.match(html, /id="reload-extension"[^>]+hidden/);
  }
  assert.ok(!(await fs.readFile(path.join(shared.output, 'core/config.js'), 'utf8')).includes('PRIVATE_SENTINEL'));
  assert.equal(shared.manifest.content_scripts, undefined);
  await assert.rejects(fs.access(path.join(shared.output, 'scripts/local')));
  const publicCatalog = JSON.parse(await fs.readFile(path.join(shared.output, 'core/script-catalog.json'), 'utf8'));
  assert.deepEqual(publicCatalog, []);
  assert.ok(!JSON.stringify(publicCatalog).includes('PRIVATE_NAME_SENTINEL'));
  // Legacy preset files no longer install any script, in either build.
  await fs.writeFile(path.join(root, 'local/profiles/unist-travel.json'), 'not JSON');
  await build({ root, publicOnly: true });
  await build({ root });
  const metadata = path.join(script, 'script.json');
  const malicious = JSON.parse(await fs.readFile(metadata, 'utf8')); malicious.entries[0].files = ['../../../outside.js'];
  await fs.writeFile(metadata, JSON.stringify(malicious));
  await assert.rejects(build({ root }), /ファイル|파일/);
  malicious.entries[0].files = ['script.js'];
  await fs.writeFile(metadata, JSON.stringify(malicious));
  await newScript({ root, id: 'unist-travel', name: 'User-created task', url: 'https://example.test' });
  const explicit = await build({ root });
  assert.equal(explicit.scripts, 2, 'An example name does not reserve or auto-install an id');
  await fs.rm(path.join(root, 'local/scripts'), { recursive: true });
  const cleaned = await build({ root });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(cleaned.output, 'core/script-catalog.json'), 'utf8')), []);
  await assert.rejects(fs.access(path.join(cleaned.output, 'scripts/local')));
  assert.throws(() => validateMatch('<all_urls>'), /사이트 범위/);
});
