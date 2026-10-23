"use strict";

(() => {
  const helper = window.MacroStudio ||= { features: {} };

  // SAP가 화면을 갱신해도 유지되는 업무 필드명으로 찾습니다.
  function locate(doc, name) {
    const suffix = name.includes(".") ? name : "main." + name;
    return [...doc.querySelectorAll("[ct]")].find(el =>
      el.getAttributeNames().some(attr => attr.startsWith("data-cust-sid") &&
        attr.replace(/"$/, "").endsWith(suffix)));
  }

  function findFrame(marker) {
    const visited = new Set();
    function visit(win) {
      try {
        if (visited.has(win)) return null;
        visited.add(win);
        if (locate(win.document, marker)) return win;
        for (const frame of win.document.querySelectorAll("iframe, frame")) {
          const found = visit(frame.contentWindow);
          if (found) return found;
        }
      } catch { /* 다른 출처의 프레임에는 접근하지 않습니다. */ }
      return null;
    }
    let found = visit(window);
    if (!found) { try { found = visit(window.top); } catch {} }
    return found;
  }

  function connect(marker) {
    return connectWindow(findFrame(marker));
  }

  function connectButton(button) {
    return connectWindow(button?.ownerDocument?.defaultView);
  }

  function connectWindow(win) {
    if (!win) throw new Error("신청서 화면을 찾지 못했습니다. 신청서를 열고 다시 실행하세요.");
    const doc = win.document;
    const api = win.UCF_Automation;
    if (!api?.Actions || !api.oLS) throw new Error("실제 포탈 화면이 준비된 뒤 다시 실행하세요.");

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    async function ready(settleMs = 50) {
      const deadline = Date.now() + 30000;
      let readySince = null;
      while (Date.now() < deadline) {
        const now = Date.now();
        if (api.oLS.bIsReady()) {
          readySince ??= now;
          if (now - readySince >= settleMs) return;
        } else {
          readySince = null;
        }
        await sleep(25);
      }
      throw new Error("화면 응답을 30초간 기다렸습니다. 포탈의 오류·안내 메시지를 확인하세요.");
    }

    function field(name) {
      const el = locate(doc, name);
      if (!el) throw new Error("입력 항목을 찾지 못했습니다: " + name);
      return el;
    }

    function read(name) {
      const el = field(name);
      return el.matches('[role="checkbox"], [role="radio"]')
        ? el.getAttribute("aria-checked") === "true" : el.value;
    }

    async function set(name, value) {
      // 직전 입력은 이미 반영을 확인했습니다. 새 작업 전에는 진행 중인 SAP 처리를 기다립니다.
      await ready(0);
      if (read(name) === value) return;
      const el = field(name);
      const role = el.getAttribute("role");
      if (role === "checkbox" || role === "radio") {
        await api.Actions[role === "checkbox" ? "CheckBox" : "RadioButton"].ChangeValue(el.id, value);
      } else if (el.getAttribute("ct") === "CB") {
        const list = doc.getElementById(el.getAttribute("aria-controls"));
        const option = list && [...list.querySelectorAll("[data-itemkey]")].find(item =>
          item.getAttribute("data-itemvalue1") === value);
        if (!option) throw new Error("선택 항목이 없습니다: " + name + " → " + value);
        await api.Actions.ComboBox.SelectListItem(el.id, option.id);
      } else if (el.tagName === "TEXTAREA") {
        await api.Actions.TextEdit.ChangeText(el.id, value);
      } else {
        await api.Actions.InputField.ChangeValue(el.id, value);
      }
      doc.activeElement?.blur();
      await ready();
      if (read(name) !== value) throw new Error("입력이 반영되지 않았습니다: " + name);
    }

    async function runExclusive(taskName, action) {
      if (win.__macroStudioRunningTask || win.__unistTripAutofillRunning) {
        throw new Error("이미 자동입력 중입니다. 완료 메시지를 기다리세요.");
      }
      win.__macroStudioRunningTask = taskName;
      try { return await action(); }
      finally { delete win.__macroStudioRunningTask; }
    }

    async function press(button, expectedLabel) {
      await ready(0);
      const el = typeof button === "string" ? field(button) : button;
      if (!el?.isConnected || el.getAttribute("ct") !== "B") throw new Error("실행할 버튼을 찾지 못했습니다.");
      const label = JSON.parse(el.getAttribute("lsdata") || "{}")["0"];
      if (label !== expectedLabel) throw new Error("버튼이 예상과 다릅니다: " + expectedLabel);
      await api.Actions.Button.Press(el.id);
      await ready();
    }

    return { win, doc, field, read, set, ready, press, runExclusive };
  }

  helper.sap = { locate, connect, connectButton };
})();
