"use strict";

(() => {
  const helper = window.MacroStudio ||= { features: {} };
  if (helper.launcher) return;
  const HOST_ID = "macro-studio-launcher";
  const POSITION_KEY = "macro-studio.launcher-position.v1";
  const SIZE = 48, GAP = 12;
  const gridIcon = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="2" fill="currentColor"/><rect x="14" y="3" width="7" height="7" rx="2" fill="currentColor" opacity=".65"/><rect x="3" y="14" width="7" height="7" rx="2" fill="currentColor" opacity=".65"/><rect x="14" y="14" width="7" height="7" rx="2" fill="currentColor"/></svg>`;
  const scriptIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h5M8 16h8"/></svg>`;

  function create() {
    if (helper.launcher.app) return helper.launcher.app;
    const definitions = new Map(), savedValues = new Map();
    let selected = null, busy = false, opened = false, position, drag = null, suppressClickUntil = 0;
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText = "position:fixed;width:48px;height:48px;z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host{all:initial;color-scheme:light} *{box-sizing:border-box}
        [hidden]{display:none!important}
        .empty{font-size:12px;color:#758297}.studio-open{width:100%;margin-top:12px;padding:11px;border:1px dashed #b5c9e4;border-radius:12px;background:white;color:#145fc0}button,input{font:inherit} button{cursor:pointer} button:disabled{cursor:default;opacity:.55}
        button:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #8bb9ff;outline-offset:3px}
        .orb{position:relative;width:48px;height:48px;display:grid;place-items:center;border:1px solid #ffffff55;
          border-radius:16px;background:#145fc0;color:#fff;box-shadow:0 4px 16px #173a6540;
          padding:13px;touch-action:none;user-select:none;cursor:grab}
        .orb:active{cursor:grabbing}.orb:hover{background:#0f50a6}.orb svg{width:22px;height:22px}
        .badge{position:absolute;right:-3px;top:-3px;width:16px;height:16px;display:grid;place-items:center;
          border:2px solid white;border-radius:50%;background:#16a34a;color:white;font:700 9px system-ui}
        .badge[data-state="running"]{background:#f59e0b}.badge[data-state="error"]{background:#dc2626}
        .panel{position:absolute;width:min(340px,calc(100vw - 24px));max-height:calc(100vh - 24px);
          overflow:auto;overscroll-behavior:contain;border:1px solid #dbe3ed;border-radius:18px;background:#fff;
          box-shadow:0 12px 44px #172b4d30;color:#1c2b40;font:14px/1.5 system-ui,-apple-system,sans-serif}
        header{display:flex;align-items:center;gap:9px;padding:16px 16px 12px;border-bottom:1px solid #eef2f7}
        .brand{flex:1;min-width:0}.brand strong{display:block;font-size:15px}.brand span{font-size:11px;color:#758297}
        .quiet{display:grid;place-items:center;border:0;background:transparent;color:#63748a;width:28px;height:28px;
          border-radius:8px;font-size:21px;padding:0}.quiet:hover{background:#f0f4fa}
        main{padding:16px}.eyebrow{margin:0 0 10px;font-size:11px;color:#718098;letter-spacing:.03em}
        .script{display:flex;gap:12px;align-items:center;width:100%;text-align:left;padding:13px 12px;
          border:1px solid #dce6f3;border-radius:12px;background:#f7faff;color:#1c2b40}
        .script:hover{border-color:#8eb5ec;background:#eff6ff}.script+.script{margin-top:8px}
        .script-icon{width:36px;height:36px;display:grid;place-items:center;border-radius:10px;background:#e8f0ff;color:#145fc0}
        .script-icon svg{width:21px;height:21px}.script-copy{flex:1;min-width:0}
        .script-copy strong{display:block;font-size:13px}.script-copy small{display:block;color:#718098;font-size:11px;margin-top:3px}
        .chevron{color:#8b9bb0;font-size:20px}
        h2{font-size:16px;margin:0 0 4px;letter-spacing:-.02em}.description{color:#6c7b90;font-size:12px;margin:0 0 17px}
        .field{display:block;font-weight:600;font-size:12px;margin-bottom:7px}
        input{display:block;width:100%;min-height:42px;padding:9px 11px;margin-top:6px;border:1px solid #c7d3e2;
          border-radius:9px;background:white;color:#1c2b40;font-size:14px}
        details{margin:15px 0;color:#5c6e86;font-size:12px}summary{cursor:pointer;font-weight:600}
        dl{margin:10px 0 0;padding:12px;background:#f7f9fc;border-radius:10px}
        dt{font-size:11px;color:#8190a3;margin-top:10px}dt:first-child{margin-top:0}
        dd{margin:2px 0 0;font-size:12px;color:#42536b;overflow-wrap:anywhere}
        .note{margin:15px 0;color:#758297;font-size:11px;line-height:1.6}
        .run{width:100%;padding:11px;border:0;border-radius:10px;background:#145fc0;color:#fff;font-weight:600;font-size:13px}
        .run:hover:enabled{background:#0f50a6}output{display:block;white-space:pre-wrap;overflow-wrap:anywhere;
          margin-top:12px;font-size:12px;color:#61728a}output:empty{display:none}
        output[data-state="error"]{color:#b42318}output[data-state="complete"]{color:#15803d}
        .sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
      </style>
      <button class="orb" type="button" aria-label="Macro Studio 열기" aria-expanded="false" aria-controls="macro-studio-menu"
        title="Macro Studio · 드래그해서 이동">${gridIcon}<span class="badge" hidden></span></button>
      <section class="panel" id="macro-studio-menu" role="dialog" aria-label="Macro Studio" hidden tabindex="-1">
        <header><button class="quiet back" type="button" aria-label="스크립트 목록으로" hidden>‹</button>
          <div class="brand"><strong>Macro Studio</strong><span>자주 하는 일을 간편하게</span></div>
          <button class="quiet close" type="button" aria-label="도우미 닫기">×</button></header>
        <main><div class="list"><p class="eyebrow">스크립트</p><div class="scripts"></div><p class="empty">등록된 스크립트가 없습니다.</p><button class="studio-open" data-studio-action="open" type="button">＋ 새 자동화 만들기</button></div>
          <div class="config" hidden><h2></h2><p class="description"></p>
            <form><div class="fields"></div><details><summary>입력 내용 확인</summary><dl></dl></details>
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
      if (busy) return;
      rememberValues();
      selected = definition;
      list.hidden = true;
      config.hidden = back.hidden = false;
      config.querySelector("h2").textContent = definition.name;
      config.querySelector(".description").textContent = definition.description || "";
      config.querySelector(".note").textContent = definition.note || "";
      output.textContent = "";
      output.dataset.state = "idle";
      runButton.textContent = definition.actionLabel || "실행";
      const fields = config.querySelector(".fields");
      fields.replaceChildren();
      controls.clear();
      const values = savedValues.get(definition.id) || {};
      for (const field of definition.fields || []) {
        const label = document.createElement("label");
        label.className = "field";
        label.textContent = field.label;
        const input = document.createElement("input");
        input.name = field.name;
        input.type = field.type || "text";
        input.required = !!field.required;
        input.value = values[field.name] ?? (typeof field.value === "function" ? field.value() : field.value) ?? "";
        label.append(input);
        fields.append(label);
        controls.set(field.name, input);
      }
      const summary = config.querySelector("dl");
      summary.replaceChildren();
      for (const [label, text] of definition.summary || []) {
        const dt = document.createElement("dt"), dd = document.createElement("dd");
        dt.textContent = label;
        dd.textContent = text;
        summary.append(dt, dd);
      }
      config.querySelector("details").open = false;
      alignPanel();
    }
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
      if (busy || !selected || !form.reportValidity()) return;
      const definition = selected;
      rememberValues();
      busy = true;
      back.disabled = runButton.disabled = true;
      for (const input of controls.values()) input.disabled = true;
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
        for (const input of controls.values()) input.disabled = false;
        runButton.textContent = definition.actionLabel || "실행";
      }
    });

    restore();
    const app = {
      register(definition) {
        if (!definition?.id || typeof definition.run !== "function") throw new Error("스크립트 정의를 확인하세요.");
        if (definitions.has(definition.id)) return;
        root.querySelector(".empty").hidden = true;
        definitions.set(definition.id, definition);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "script";
        button.dataset.scriptId = definition.id;
        button.innerHTML = `<span class="script-icon">${scriptIcon}</span><span class="script-copy"><strong></strong><small></small></span><span class="chevron" aria-hidden="true">›</span>`;
        button.querySelector("strong").textContent = definition.name;
        button.querySelector("small").textContent = definition.description || "";
        button.addEventListener("click", () => choose(definition));
        root.querySelector(".scripts").append(button);
      }
    };
    helper.launcher.app = app;
    return app;
  }
  helper.launcher = { create };
})();
