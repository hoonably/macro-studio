export const LOADED_BUILD_KEY = 'macroStudioLoadedBuild';
const validId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

// Only compare completed local builds. Never fetch or execute remote update code.
export function createBuildUpdater(chrome, { loadedBuild, fetchBuild, apply }) {
  let checking, reloading = false;
  const diskId = async () => {
    const value = await fetchBuild();
    if (!validId(value?.id)) throw new Error('완료된 빌드가 아닙니다.');
    return value.id;
  };
  async function installed() {
    // Worker suspension must not mistake a new disk build for already loaded code.
    const id = validId(loadedBuild) ? loadedBuild : await diskId();
    await chrome.storage.local.set({ [LOADED_BUILD_KEY]: id });
  }
  async function checkImpl() {
    if (reloading) return { applying: true };
    let id;
    try { id = await diskId(); } catch { return { unavailable: true }; }
    let loaded = (await chrome.storage.local.get(LOADED_BUILD_KEY))[LOADED_BUILD_KEY];
    if (!validId(loaded)) {
      loaded = validId(loadedBuild) ? loadedBuild : id;
      await chrome.storage.local.set({ [LOADED_BUILD_KEY]: loaded });
    }
    if (id === loaded) return { pending: false };
    const applied = await apply(async () => await diskId() === id);
    if (applied) reloading = true;
    return { pending: !applied, applying: applied };
  }
  function check() {
    if (!checking) checking = checkImpl().finally(() => { checking = null; });
    return checking;
  }
  return { installed, check };
}
