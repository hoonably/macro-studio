"use strict";
(() => {
  const studio = window.MacroStudio;
  if (studio.scriptProxy) return;
  studio.scriptProxy = {
    mount(definitions) {
      const launcher = studio.launcher.create();
      for (const definition of definitions) launcher.replace({ ...definition, async run(values, report) {
        const host = document.getElementById('macro-studio-launcher'), requestId = crypto.randomUUID();
        return new Promise((resolve, reject) => {
          const progress = event => { try { const data = JSON.parse(event.detail); if (data.requestId === requestId) report(data.message); } catch {} };
          const finish = event => {
            let data; try { data = JSON.parse(event.detail); } catch { return; }
            if (data.requestId !== requestId) return;
            host.removeEventListener('macro-studio:script-progress', progress);
            host.removeEventListener('macro-studio:script-result', finish);
            data.error ? reject(new Error(data.error)) : resolve(data.value);
          };
          host.addEventListener('macro-studio:script-progress', progress);
          host.addEventListener('macro-studio:script-result', finish);
          host.dispatchEvent(new CustomEvent('macro-studio:script-run', { detail: JSON.stringify({ ...definition.local, values, requestId }) }));
        });
      } });
    }
  };
})();
