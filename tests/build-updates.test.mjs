import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildUpdater, LOADED_BUILD_KEY } from '../extension/core/build-updates.js';

const first = 'a'.repeat(64), second = 'b'.repeat(64), third = 'c'.repeat(64);
function fixture(local = {}) {
  let disk = first, busy = false, unavailable = false, applications = 0;
  const chrome = { storage: { local: { get: async key => ({ [key]: local[key] }), set: async values => Object.assign(local, values) } } };
  const updater = createBuildUpdater(chrome, { loadedBuild: first,
    fetchBuild: async () => { if (unavailable) throw new Error('Staging'); return { id: disk }; },
    apply: async confirm => { if (busy || !await confirm()) return false; applications++; return true; }
  });
  return { updater, local, get applications() { return applications; }, disk: id => { disk = id; }, busy: value => { busy = value; }, unavailable: value => { unavailable = value; } };
}
test('completed builds apply once, identical builds do nothing, and worker restarts retain the loaded baseline', async () => {
  const env = fixture();
  await env.updater.installed();
  assert.deepEqual(await env.updater.check(), { pending: false });
  env.disk(second);
  await Promise.all([env.updater.check(), env.updater.check()]);
  assert.equal(env.applications, 1);
  await env.updater.check(); assert.equal(env.applications, 1);
  assert.equal(env.local[LOADED_BUILD_KEY], first, 'Only the actual installed event may mark new code as loaded');
  const restarted = fixture(env.local); restarted.disk(second);
  assert.equal((await restarted.updater.check()).applying, true);
  assert.equal(restarted.applications, 1);
});
test('busy tasks defer without losing the candidate; incomplete builds never replace the loaded code', async () => {
  const env = fixture(); await env.updater.installed(); env.disk(second); env.busy(true);
  assert.equal((await env.updater.check()).pending, true); assert.equal(env.applications, 0);
  env.unavailable(true); assert.equal((await env.updater.check()).unavailable, true);
  env.unavailable(false); env.disk('broken'); assert.equal((await env.updater.check()).unavailable, true);
  assert.equal(env.local[LOADED_BUILD_KEY], first);
  env.disk(third); env.busy(false);
  assert.equal((await env.updater.check()).applying, true); assert.equal(env.applications, 1);
});
test('a first check still notices a build made after this worker loaded', async () => {
  const env = fixture(); env.disk(second);
  assert.equal((await env.updater.check()).applying, true);
  assert.equal(env.local[LOADED_BUILD_KEY], first);
});
