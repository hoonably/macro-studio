"use strict";

(() => {
  const helper = window.MacroStudio ||= { features: {} };
  if (helper.launcher) return;
  const HOST_ID = "macro-studio-launcher";
  const POSITION_KEY = "macro-studio.launcher-position.v1";
  const LIBRARY_EVENT = "macro-studio:library-state";
  const SIZE = 48, GAP = 12;
  const brandIcon = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\">\n  <rect width=\"64\" height=\"64\" rx=\"15\" fill=\"#2A3C91\"/>\n  <path d=\"M32 12h14c6 0 10 4.4 10 10v6H36Z\" fill=\"#96ACF9\"/>\n  <path fill=\"#FFF3D9\" fill-rule=\"evenodd\" d=\"M29 12h17c-4.7 1.2-6.8 5.6-8 11.7l-3.2 15.5C33.5 45.9 30.2 50.4 26 53H6c5.4-4.7 8.1-10 9.4-16.6l2.8-13.7C19.7 15.5 23 12 29 12Zm-4.6 9-1.1 5h5l1.1-5Zm-2.1 10-1.1 5h5l1.1-5Zm7.6 0-1.1 5h4.6l1.1-5Zm-10 10-1.9 5h5.1l1.9-5Z\"/>\n</svg>";
  const scriptIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h5M8 16h8"/></svg>`;
  const archiveIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 8h16v12H4zM3 4h18v4H3zM9 12h6"/></svg>`;

  const fieldIcons = {
    locked: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    unlocked: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/>',
    hide: '<path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9 5.5a11 11 0 0 1 12 6.5 15 15 0 0 1-4 4M6 6a15 15 0 0 0-3 6s3 7 9 7a10 10 0 0 0 4-.8"/>',
    edit: '<path d="m16 4 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L5 15 4 20Z"/>',
    save: '<path d="m5 12 4 4L19 6"/>',
    cancel: '<path d="m6 6 12 12M18 6 6 18"/>',
    show: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'
  };
  const fieldIcon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + fieldIcons[name] + '</svg>';
  const configurableTypes = new Set(['text','select','date','time','number','email','url','tel','search','datetime-local']);

  function create() {
    if (helper.launcher.app) return helper.launcher.app;
    const definitions = new Map(), savedValues = new Map(), pendingDefinitions = new Map();
    let nameEditing = null;
    let selected = null, busy = false, opened = false, position, drag = null, suppressClickUntil = 0, configRefresh = false;
    let library = { ready: false, archived: [], deleted: [], pending: null, fieldPreferences: {} };
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.hidden = true;
    host.style.cssText = "display:none;position:fixed;width:48px;height:48px;z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host{all:initial;color-scheme:light} *{box-sizing:border-box}
        [hidden]{display:none!important}
        .empty{font-size:12px;color:#5c6e86}.studio-open{width:100%;margin-top:12px;padding:11px;border:1px dashed #b5c9e4;border-radius:12px;background:white;color:#145fc0}button,input,select{font:inherit} button{cursor:pointer} button:disabled{cursor:default;opacity:.55}
        button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #8bb9ff;outline-offset:3px}
        .orb{position:relative;width:48px;height:48px;display:grid;place-items:center;border:1px solid #ffffff55;
          border-radius:12px;background:#2A3C91;color:#fff;box-shadow:0 4px 16px #173a6540;
          padding:0;touch-action:none;user-select:none;cursor:grab}
        .orb:active{cursor:grabbing}.orb:hover{filter:brightness(1.07)}.orb svg{width:100%;height:100%;display:block;pointer-events:none}
        .badge{position:absolute;right:-3px;top:-3px;width:16px;height:16px;display:grid;place-items:center;
          border:2px solid white;border-radius:50%;background:#16a34a;color:white;font:700 9px system-ui}
        .badge[data-state="running"]{background:#f59e0b}.badge[data-state="error"]{background:#dc2626}
        .panel{position:absolute;width:min(340px,calc(100vw - 24px));max-height:calc(100vh - 24px);
          overflow:auto;overscroll-behavior:contain;border:1px solid #dbe3ed;border-radius:18px;background:#fff;
          box-shadow:0 12px 44px #00000026;color:#1c2b40;font:14px/1.5 system-ui,-apple-system,sans-serif}
        header{display:flex;align-items:center;gap:9px;padding:16px 16px 12px;border-bottom:1px solid #eef2f7}
        .brand{flex:1;min-width:0}.brand strong{display:block;font-size:15px}.brand span{font-size:11px;color:#5c6e86}
        .quiet{display:grid;place-items:center;border:0;background:transparent;color:#63748a;width:28px;height:28px;
          border-radius:8px;font-size:21px;padding:0}.quiet:hover{background:#f0f4fa}
        main{padding:16px}
        .script-row{display:flex;gap:6px;align-items:center}.script-row+.script-row{margin-top:8px}
        .script-archive{flex:none;width:32px;height:36px;font-size:14px}.script-archive svg{width:18px;height:18px}
        .library-open{border:0;background:transparent;color:#61728a;padding:10px 0 0;font-size:12px}
        .list-status{font-size:12px;color:#15803d;margin:10px 0 0}.list-status:empty{display:none}.list-status[data-error="true"]{color:#b42318}
        .script{display:flex;gap:10px;align-items:center;width:100%;min-width:0;text-align:left;padding:13px 12px;
          border:1px solid #dce6f3;border-radius:12px;background:#f7faff;color:#1c2b40}
        .script:hover{border-color:#8eb5ec;background:#eff6ff}
        .script-icon{width:36px;height:36px;display:grid;place-items:center;border-radius:10px;background:#e8f0ff;color:#145fc0}
        .script-icon svg{width:21px;height:21px}.script-copy{flex:1;min-width:0}
        .script-copy strong{display:block;font-size:13px}.script-copy small{display:block;color:#5c6e86;font-size:11px;margin-top:3px}
        .chevron{color:#8b9bb0;font-size:20px}
        h2{font-size:16px;margin:0 0 4px;letter-spacing:-.02em}.description{color:#6c7b90;font-size:12px;margin:0 0 17px}
        .field{display:block;font-weight:600;font-size:12px;margin-bottom:12px;min-width:0}
        .field-heading{display:flex;align-items:center;gap:8px;min-height:28px}.field-heading label{flex:1;min-width:0;overflow-wrap:anywhere}
        .field-actions{display:flex;gap:2px;flex:none}.field-action{display:grid;place-items:center;flex:none;width:28px;height:28px;padding:5px;border:0;border-radius:7px;background:transparent;color:#5c6e86}
        .field-action svg{width:16px;height:16px}.field-action:hover:enabled{background:#edf3fb;color:#145fc0}
        .field-action[aria-pressed=true]{color:#145fc0;background:#edf3fb}
        .field[data-locked=true] :is(input,select){background:#f3f5f8;color:#526175;-webkit-text-fill-color:#526175;opacity:1}
        .hidden-fields{margin:12px 0}.hidden-fields summary{font-weight:500}.hidden-list{margin:8px 0 0;padding:0;list-style:none}
        .hidden-list li{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #eef2f7}.hidden-copy{flex:1;min-width:0}
        .hidden-copy strong{display:block;font-size:12px;color:#42536b}.hidden-copy small{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:12px;color:#5c6e86}
        .config-title{display:flex;align-items:flex-start;gap:8px;margin-bottom:4px}.config-title h2{flex:1;min-width:0;overflow-wrap:anywhere}.config-title .rename-open{margin-top:-3px}
        .macro-name-editor{display:flex;align-items:center;gap:4px;margin-bottom:8px}.macro-name-editor input{flex:1;width:0;min-width:0;margin:0;font-size:14px;padding:7px 9px;min-height:36px}.rename-save{color:#145fc0;background:#edf3fb}
        .name-feedback{font-size:12px;color:#b42318;margin:6px 0 10px;overflow-wrap:anywhere}.name-feedback:empty{display:none}
        .field-feedback{font-size:12px;color:#b42318;line-height:1.6;margin:10px 0}.field-feedback:empty{display:none}
        input,select{caret-color:#1c2b40}::selection{background:#dce9fb;color:#1c2b40}
        .panel{scrollbar-color:#a3afbf #fff}
        input,select{display:block;width:100%;min-height:42px;padding:9px 11px;margin-top:6px;border:1px solid #c7d3e2;
          border-radius:9px;background:white;color:#1c2b40;font-size:14px}
        details{margin:15px 0;color:#5c6e86;font-size:12px}summary{cursor:pointer;font-weight:600}
        dl{margin:10px 0 0;padding:12px;background:#f7f9fc;border-radius:10px}
        dt{font-size:11px;color:#5c6e86;margin-top:10px}dt:first-child{margin-top:0}
        dd{margin:2px 0 0;font-size:12px;color:#42536b;overflow-wrap:anywhere}
        .note{margin:15px 0;color:#5c6e86;font-size:12px;line-height:1.6}
        .run{width:100%;padding:11px;border:0;border-radius:10px;background:#145fc0;color:#fff;font-weight:600;font-size:13px}
        .run:hover:enabled{background:#0f50a6}output{display:block;white-space:pre-wrap;overflow-wrap:anywhere;
          margin-top:12px;font-size:12px;color:#61728a}output:empty{display:none}
        output[data-state="error"]{color:#b42318}output[data-state="complete"]{color:#15803d}
        .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
      </style>
      <button class="orb" type="button" aria-label="Macro Studio 열기" aria-expanded="false" aria-controls="macro-studio-menu"
        title="Macro Studio · 드래그해서 이동">${brandIcon}<span class="badge" hidden></span></button>
      <section class="panel" id="macro-studio-menu" role="dialog" aria-label="Macro Studio" hidden tabindex="-1">
        <header><button class="quiet back" type="button" aria-label="스크립트 목록으로" hidden>‹</button>
          <div class="brand"><strong>Macro Studio</strong><span>자주 하는 일을 간편하게</span></div>
          <button class="quiet close" type="button" aria-label="도우미 닫기">×</button></header>
        <main><div class="list"><div class="scripts"></div><p class="empty">스크립트를 불러오는 중…</p><p class="list-status" role="status"></p><button class="studio-open" data-studio-action="open" type="button">＋ 새 자동화 만들기</button><button class="library-open" data-studio-action="library" type="button">스크립트 보관함</button></div>
          <div class="config" hidden><div class="config-title"><h2></h2><button type="button" class="field-action rename-open" title="매크로 이름 수정" aria-label="매크로 이름 수정">${fieldIcon('edit')}</button></div>
            <div class="macro-name-editor" hidden><input class="macro-name" aria-label="매크로 이름" maxlength="100" autocomplete="off"><button class="field-action rename-save" data-studio-action="rename-script" type="button" title="이름 저장" aria-label="이름 저장">${fieldIcon('save')}</button><button class="field-action rename-cancel" type="button" title="수정 취소" aria-label="수정 취소">${fieldIcon('cancel')}</button></div><p class="name-feedback" role="status" aria-live="polite"></p><p class="description"></p>
            <form><p class="field-feedback" role="status" aria-live="polite"></p><div class="fields"></div><details class="hidden-fields" hidden><summary title="숨긴 값도 실행에 그대로 사용됩니다."></summary><ul class="hidden-list"></ul></details><details class="input-summary"><summary>입력 내용 확인</summary><dl></dl></details>
              <p class="note"></p><button class="run" type="submit">신청 준비</button></form>
            <output aria-live="polite"></output></div></main>
      </section><span class="sr announcement" role="status" aria-live="polite"></span>`;
    const orb = root.querySelector(".orb"), panel = root.querySelector(".panel");
    const list = root.querySelector(".list"), config = root.querySelector(".config");
    const back = root.querySelector(".back"), form = root.querySelector("form");
    const runButton = root.querySelector(".run"), output = root.querySelector("output");
    const badge = root.querySelector(".badge"), announcement = root.querySelector(".announcement");
    const controls = new Map();
    (document.body || document.documentElement).append(host);

    function limits() {
      return { x: Math.max(GAP, window.innerWidth - SIZE - GAP), y: Math.max(GAP, window.innerHeight - SIZE - GAP) };
    }
    function alignPanel() {
      if (!position) return;
      const width = Math.min(340, window.innerWidth - GAP * 2);
      const left = Math.max(GAP, Math.min(position.x + SIZE - width, window.innerWidth - width - GAP));
      panel.style.left = (left - position.x) + "px";
      panel.style.top = "auto";
      panel.style.bottom = "auto";
      const above = position.y - GAP;
      const below = window.innerHeight - position.y - SIZE - GAP;
      if (above >= below) {
        panel.style.bottom = (SIZE + GAP) + "px";
        panel.style.maxHeight = Math.max(80, above) + "px";
      } else {
        panel.style.top = (SIZE + GAP) + "px";
        panel.style.maxHeight = Math.max(80, below) + "px";
      }
    }
    function move(x, y) {
      const max = limits();
      position = { x: Math.round(Math.max(GAP, Math.min(x, max.x))), y: Math.round(Math.max(GAP, Math.min(y, max.y))) };
      host.style.left = position.x + "px";
      host.style.top = position.y + "px";
      alignPanel();
    }
    function remember() {
      const max = limits();
      try { window.localStorage.setItem(POSITION_KEY, JSON.stringify({
        x: max.x > GAP ? (position.x - GAP) / (max.x - GAP) : 1,
        y: max.y > GAP ? (position.y - GAP) / (max.y - GAP) : 1
      })); } catch { /* 저장소를 사용할 수 없어도 이동은 가능합니다. */ }
    }
    function restore() {
      const max = limits();
      let saved;
      try { saved = JSON.parse(window.localStorage.getItem(POSITION_KEY)); } catch {}
      const valid = saved && [saved.x, saved.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1);
      move(valid ? GAP + saved.x * (max.x - GAP) : max.x,
        valid ? GAP + saved.y * (max.y - GAP) : max.y);
    }
    function close(returnFocus = true) {
      opened = false;
      panel.hidden = true;
      orb.setAttribute("aria-expanded", "false");
      if (returnFocus) orb.focus({ preventScroll: true });
    }
    function open() {
      if (host.hidden) return;
      opened = true;
      panel.hidden = false;
      orb.setAttribute("aria-expanded", "true");
      alignPanel();
      panel.focus({ preventScroll: true });
    }
    function rememberValues() {
      if (selected) savedValues.set(selected.id, Object.fromEntries([...controls].map(([key, input]) => [key, input.value])));
    }
    function showList() {
      if (busy) return;
      rememberValues();
      selected = null;
      list.hidden = false;
      config.hidden = back.hidden = true;
    }
    function choose(definition) {
      if (busy || !library.ready || library.siteEnabled === false || library.pending || unavailable(definition.id)) return;
      rememberValues();
      if (selected?.id !== definition.id) { nameEditing = null; config.querySelector('.name-feedback').textContent = ''; }
      selected = definition;
      configRefresh = false;
      form.dataset.scriptId = definition.id;
      form.dataset.localScript = definition.local?.id || '';
      form.dataset.localRevision = definition.local?.revision || '';
      list.hidden = true;
      config.hidden = back.hidden = false;
      config.querySelector("h2").textContent = definition.name;
      renderNameEditor();
      config.querySelector(".description").textContent = definition.description || "";
      config.querySelector(".note").textContent = definition.note || "";
      output.textContent = "";
      output.dataset.state = "idle";
      runButton.textContent = definition.actionLabel || "실행";
      const fields = config.querySelector(".fields");
      fields.replaceChildren();
      controls.clear();
      const values = savedValues.get(definition.id) || {};
      const hiddenList = config.querySelector('.hidden-list'); hiddenList.replaceChildren();
      config.querySelector('.field-feedback').textContent = '';
      let hiddenCount = 0;
      for (const [index, field] of (definition.fields || []).slice(0, 60).entries()) {
        const row = document.createElement('div'); row.className = 'field'; row.dataset.fieldName = field.name;
        const heading = document.createElement('div'); heading.className = 'field-heading';
        const label = document.createElement('label'); label.textContent = field.label; heading.append(label);
        const input = document.createElement(field.type === 'select' ? 'select' : 'input');
        const type = field.type || 'text'; input.name = field.name; input.dataset.fieldType = type;
        input.id = 'macro-field-' + index; label.htmlFor = input.id;
        if (type === 'select') {
          const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = '선택하세요'; input.append(placeholder);
          for (const item of (field.options || []).slice(0, 100)) {
            const option = document.createElement('option'); option.value = String(item.value); option.textContent = String(item.label ?? item.value); input.append(option);
          }
        } else input.type = type;
        input.required = !!field.required;
        let pref = library.fieldPreferences?.[definition.id]?.[field.name] || {};
        if (pref.type !== type || typeof pref.value !== 'string' || (type === 'select' && ![...input.options].some(option => option.value === pref.value))) pref = {};
        const value = pref.value ?? values[field.name] ?? (typeof field.value === 'function' ? field.value() : field.value) ?? '';
        if (type === 'select') {
          const option = [...input.options].find(option => option.value === String(value)) || input.options[0]; option.selected = true;
        } else input.value = value;
        // Changed definitions must expose an invalid saved value for correction.
        if (input.checkValidity?.() === false) pref = {};
        row.dataset.locked = String(!!pref.locked); row.hidden = !!pref.hidden;
        const eligible = configurableTypes.has(type) && /^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/.test(field.name) && !['constructor','prototype','__proto__'].includes(field.name);
        if (eligible) {
          const actions = document.createElement('div'); actions.className = 'field-actions';
          actions.append(fieldButton(definition, field, pref.locked ? 'locked' : 'unlocked', 'locked', !pref.locked, input),
            fieldButton(definition, field, 'hide', 'hidden', true, input));
          heading.append(actions);
        }
        row.append(heading, input); fields.append(row); controls.set(field.name, input);
        if (pref.hidden && eligible) {
          hiddenCount++;
          const item = document.createElement('li'), copy = document.createElement('div'), name = document.createElement('strong'), preview = document.createElement('small');
          copy.className = 'hidden-copy'; name.textContent = field.label;
          preview.textContent = type === 'select' ? [...input.options].find(option => option.value === input.value)?.textContent || input.value : input.value || '값 없음';
          copy.append(name, preview); item.append(copy, fieldButton(definition, field, 'show', 'hidden', false, input)); hiddenList.append(item);
        }
      }
      config.querySelector('.hidden-fields').hidden = !hiddenCount;
      config.querySelector('.hidden-fields > summary').textContent = '숨긴 항목 ' + hiddenCount + '개';
      updateFieldControls();
      const summary = config.querySelector("dl");
      summary.replaceChildren();
      for (const [label, text] of definition.summary || []) {
        const dt = document.createElement("dt"), dd = document.createElement("dd");
        dt.textContent = label;
        dd.textContent = text;
        summary.append(dt, dd);
      }
      config.querySelector(".input-summary").open = false;
      alignPanel();
    }
    function renderNameEditor() {
      const editing = !!selected && nameEditing === selected.id;
      config.querySelector('.config-title').hidden = editing;
      config.querySelector('.macro-name-editor').hidden = !editing;
      config.querySelector('.rename-open').hidden = !selected?.local?.id;
      for (const button of config.querySelectorAll('.rename-open,.rename-save,.rename-cancel')) button.disabled = busy || !library.ready || !!library.pending;
      config.querySelector('.macro-name').disabled = busy || !!library.pending;
    }
    function cancelNameEdit() {
      if (busy || library.pending) return;
      nameEditing = null; config.querySelector('.name-feedback').textContent = ''; renderNameEditor(); config.querySelector('.rename-open').focus();
    }
    config.querySelector('.rename-open').addEventListener('click', () => {
      if (!selected?.local?.id || busy || library.pending) return;
      nameEditing = selected.id; config.querySelector('.name-feedback').textContent = '';
      const input = config.querySelector('.macro-name'); input.value = selected.name; renderNameEditor(); input.focus(); input.select?.();
    });
    config.querySelector('.rename-cancel').addEventListener('click', cancelNameEdit);
    config.querySelector('.macro-name').addEventListener('keydown', event => {
      if (event.key === 'Escape' && !event.isComposing) {event.preventDefault(); cancelNameEdit();}
    });
    function fieldButton(definition, field, icon, action, enabled, input) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'field-action';
      const label = action === 'locked' ? enabled ? '현재 값으로 잠금' : '잠금 해제' : enabled ? '값을 유지하고 숨기기' : '다시 표시';
      button.innerHTML = fieldIcon(icon); button.title = label; button.setAttribute('aria-label', field.label + ' · ' + label);
      if (action === 'locked') button.setAttribute('aria-pressed', String(!enabled));
      Object.assign(button.dataset, {studioAction:action === 'locked' ? 'field-lock' : 'field-hide',scriptId:definition.id,fieldName:field.name,enabled:String(enabled)});
      button.addEventListener('click', () => {
        if (busy || !library.ready || library.siteEnabled === false) return;
        if (enabled) {
          const wasDisabled = input.disabled; input.disabled = false;
          const valid = input.checkValidity?.() !== false;
          if (!valid) input.reportValidity?.(); input.disabled = wasDisabled;
          if (!valid) { config.querySelector('.field-feedback').textContent = '값을 올바르게 입력한 뒤 잠그거나 숨기세요.'; return; }
        }
        // The isolated bridge persists trusted clicks and publishes its result.
        if (library.pending) return;
        rememberValues();
        const prefs = {...library.fieldPreferences}, fields = {...prefs[definition.id]};
        const before = fields[field.name]?.type === (field.type || 'text') ? fields[field.name] : {locked:false,hidden:false};
        const next = {...before,type:field.type || 'text',[action]:enabled,value:input.value};
        if (next.locked || next.hidden) fields[field.name] = next; else delete fields[field.name];
        prefs[definition.id] = fields; library.fieldPreferences = prefs; choose(definition);
      });
      return button;
    }
    function updateFieldControls() {
      for (const input of controls.values()) input.disabled = busy || input.closest('.field')?.dataset.locked === 'true';
      for (const button of root.querySelectorAll('.field-action')) button.disabled = busy || !library.ready || library.siteEnabled === false || !!library.pending;
    }
    function unavailable(id) {
      return library.archived.includes(id) || library.deleted.includes(id) || (library.available && !library.available.includes(id));
    }
    function updateVisibility() {
      const hasScripts = [...definitions.keys()].some(id => !library.deleted.includes(id) && (!library.available || library.available.includes(id)));
      const visible = busy || (library.ready && library.siteEnabled !== false &&
        (library.siteEnabled === true || hasScripts || library.archived.length > 0));
      if (!visible && opened) close(false);
      host.hidden = !visible;
      // Inline display also hides the host when its shadow :host styles reset browser defaults.
      host.style.display = visible ? 'block' : 'none';
    }
    function renderScripts() {
      if (selected && !busy && library.ready && !library.pending && !unavailable(selected.id) &&
          (configRefresh || definitions.get(selected.id) !== selected)) {
        const scroll = panel.scrollTop, message = output.textContent, state = output.dataset.state;
        choose(definitions.get(selected.id));
        panel.scrollTop = scroll; output.textContent = message; output.dataset.state = state;
      }
      renderNameEditor();
      host.setAttribute('aria-busy', String(busy));
      const scripts = root.querySelector('.scripts');
      scripts.replaceChildren();
      if (library.ready) for (const definition of definitions.values()) {
        if (unavailable(definition.id)) continue;
        const row = document.createElement('div'); row.className = 'script-row';
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'script'; button.dataset.scriptId = definition.id;
        button.disabled = busy || library.siteEnabled === false || !!library.pending;
        button.innerHTML = `<span class="script-icon">${scriptIcon}</span><span class="script-copy"><strong></strong><small></small></span><span class="chevron" aria-hidden="true">›</span>`;
        button.querySelector('strong').textContent = definition.name;
        button.querySelector('small').textContent = definition.description || '';
        button.addEventListener('click', () => choose(definition));
        const archive = document.createElement('button');
        archive.type = 'button'; archive.className = 'quiet script-archive'; archive.innerHTML = archiveIcon;
        archive.title = '보관함으로 이동'; archive.setAttribute('aria-label', definition.name + ' 보관함으로 이동');
        archive.dataset.studioAction = 'archive-script'; archive.dataset.scriptId = definition.id;
        archive.disabled = busy || library.siteEnabled === false || !!library.pending;
        row.append(button, archive); scripts.append(row);
      }
      const empty = root.querySelector('.empty');
      empty.hidden = !!scripts.children.length;
      empty.textContent = library.ready ? '아직 실행할 스크립트가 없습니다. 새 자동화를 만들어 보세요.' :
        library.error ? '스크립트를 불러오지 못했습니다. 확장과 페이지를 새로고침하세요.' : '스크립트를 불러오는 중…';
      runButton.disabled = busy || !library.ready || library.siteEnabled === false || !!library.pending || !!(selected && unavailable(selected.id));
      root.querySelector('.studio-open').disabled = busy || !library.ready || library.siteEnabled === false;
      updateFieldControls();
      updateVisibility();
    }
    function applyLibraryState(state) {
      if (!state || !Array.isArray(state.archived) || !Array.isArray(state.deleted)) return;
      const nextPreferences = state.fieldPreferences && typeof state.fieldPreferences === 'object' ? state.fieldPreferences : {};
      const preferencesChanged = JSON.stringify(library.fieldPreferences) !== JSON.stringify(nextPreferences);
      configRefresh ||= preferencesChanged;
      if (state.renamed && typeof state.renamed.id === 'string' && typeof state.renamed.name === 'string' && definitions.has(state.renamed.id)) {
        const definition = definitions.get(state.renamed.id); definitions.set(state.renamed.id,{...definition,name:state.renamed.name});
        if (nameEditing === state.renamed.id) nameEditing = null;
        config.querySelector('.name-feedback').textContent = ''; configRefresh = true;
      }
      if (typeof state.renameError === 'string') config.querySelector('.name-feedback').textContent = state.renameError;
      library = { fieldPreferences:nextPreferences, ready: state.ready === true, archived: state.archived.filter(id => typeof id === 'string'),
        deleted: state.deleted.filter(id => typeof id === 'string'), available: Array.isArray(state.available) ? state.available.filter(id => typeof id === 'string') : null,
        siteEnabled: typeof state.siteEnabled === 'boolean' ? state.siteEnabled : null,
        pending: state.pending || null, error: state.error || '' };
      if (selected && unavailable(selected.id) && !busy) showList();
      for (const id of library.deleted) savedValues.delete(id);
      renderScripts();
      const message = root.querySelector('.list-status'); message.textContent = state.error || state.message || '';
      message.dataset.error = String(!!state.error);
      if (state.message) announcement.textContent = state.message;
      config.querySelector('.field-feedback').textContent = state.fieldError || '';
    }
    // This DOM channel only updates presentation; privileged writes require a trusted isolated-world click.
    host.addEventListener(LIBRARY_EVENT, event => {
      try { if (typeof event.detail === 'string') applyLibraryState(JSON.parse(event.detail)); } catch {}
    });
    function report(text, state = "running") {
      output.textContent = text;
      output.dataset.state = state;
      announcement.textContent = text;
      badge.hidden = false;
      badge.dataset.state = state;
      badge.textContent = state === "complete" ? "✓" : state === "error" ? "!" : "•";
      orb.title = "Macro Studio · " + text;
    }

    orb.addEventListener("click", event => {
      if (event.detail !== 0 && Date.now() < suppressClickUntil) return;
      if (opened) close();
      else { if (!busy) showList(); open(); }
    });
    orb.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.isPrimary === false) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: position.x, top: position.y, moved: false };
      try { orb.setPointerCapture(event.pointerId); } catch {}
    });
    orb.addEventListener("pointermove", event => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      event.preventDefault();
      move(drag.left + dx, drag.top + dy);
    });
    function endDrag(event) {
      if (!drag || event.pointerId !== drag.id) return;
      if (drag.moved) { remember(); suppressClickUntil = Date.now() + 300; }
      drag = null;
      try { orb.releasePointerCapture(event.pointerId); } catch {}
    }
    orb.addEventListener("pointerup", endDrag);
    orb.addEventListener("pointercancel", endDrag);
    root.querySelector(".close").addEventListener("click", () => close());
    back.addEventListener("click", showList);
    root.addEventListener("keydown", event => {
      if (event.key === "Escape" && opened) { event.stopPropagation(); close(); }
    });
    document.addEventListener("pointerdown", event => {
      if (opened && !event.composedPath().includes(host)) close(false);
    }, true);
    window.addEventListener("resize", () => { move(position.x, position.y); });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (busy || !library.ready || library.siteEnabled === false || library.pending || !selected || unavailable(selected.id) || !form.reportValidity()) return;
      const definition = selected;
      rememberValues();
      busy = true;
      renderScripts();
      back.disabled = runButton.disabled = true;
      updateFieldControls();
      runButton.textContent = "진행 중…";
      report("준비 중…");
      try {
        const message = await definition.run({ ...savedValues.get(definition.id) }, text => report(text));
        report(message || "완료했습니다.", "complete");
        close();
      } catch (error) {
        report("중단: " + error.message, "error");
        open();
      } finally {
        busy = false;
        back.disabled = runButton.disabled = false;
        updateFieldControls();
        runButton.textContent = definition.actionLabel || "실행";
        if (selected && unavailable(selected.id)) showList();
        for (const definition of pendingDefinitions.values()) app.replace(definition);
        pendingDefinitions.clear();
        renderScripts();
      }
    });

    restore();
    const app = {
      register(definition) {
        if (!definition?.id || typeof definition.run !== "function") throw new Error("스크립트 정의를 확인하세요.");
        if (definitions.has(definition.id)) return;
        definitions.set(definition.id, definition);
        renderScripts();
      },
      replace(definition) {
        if (!definition?.id || typeof definition.run !== 'function') throw new Error('스크립트 정의를 확인하세요.');
        if (busy) { pendingDefinitions.set(definition.id, definition); return; }
        definitions.set(definition.id, definition);
        if (selected?.id === definition.id) choose(definition);
        renderScripts();
      },
      applyLibraryState
    };
    helper.launcher.app = app;
    return app;
  }
  helper.launcher = { create };
})();
