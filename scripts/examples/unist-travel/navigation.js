"use strict";

(() => {
  if (window !== window.top) return;
  const helper = window.MacroStudio;
  const feature = helper.features.travelRequest;
  if (feature.portalNavigationRegistered) return;
  feature.portalNavigationRegistered = true;
  const CHANNEL = "macro-studio-unist-travel-v1";
  const SAP = "https://s4hana.unist.ac.kr";
  const normalize = text => String(text || "").replace(/\s+/g, " ").trim();
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const launcher = helper.launcher.create();
  let job = null;

  function findMenu(selector, label) {
    const matches = [...document.querySelectorAll(selector)].filter(el =>
      el.getClientRects().length && normalize(el.getAttribute("displayname") ||
        el.getAttribute("nodetitle") || el.getAttribute("title") || el.textContent) === label);
    if (matches.length > 1) throw new Error(label + " 메뉴를 하나로 찾지 못했습니다.");
    return matches[0];
  }
  async function waitFor(read, description, timeout = 45000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const value = read();
      if (value) return value;
      await pause(100);
    }
    throw new Error(description + " 화면을 기다리다 중단했습니다. 포탈을 확인하고 다시 실행하세요.");
  }
  async function selectMenu(selector, text, next) {
    job.report("이동 중: " + text);
    const item = await waitFor(() => findMenu(selector, text), text);
    // 이미 선택된 메뉴를 다시 누르면 SAP 프레임이 중복으로 열릴 수 있습니다.
    if (item.getAttribute("isselected") !== "true") {
      item.focus();
      for (const type of ["mousedown", "mouseup"]) {
        if (!item.isConnected || item.getAttribute("isselected") === "true") break;
        item.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true,
          view: window, button: 0, buttons: type === "mousedown" ? 1 : 0 }));
      }
      if (item.isConnected && item.getAttribute("isselected") !== "true") item.click();
    }
    await waitFor(() => {
      const current = findMenu(selector, text);
      return current?.getAttribute("isselected") === "true" && next();
    }, text);
  }
  function sapFrame() {
    try {
      const area = document.getElementById("contentAreaFrame")?.contentDocument;
      const frame = area?.getElementById("isolatedWorkArea");
      // src에는 빈 문서 주소가 남기도 합니다. 실제 응답 origin과 Window를 함께 검사합니다.
      return frame?.tagName === "IFRAME" && frame.getClientRects().length &&
        normalize(frame.title) === "국내출장 신청" ? frame : null;
    } catch { return null; }
  }
  function send(type, more = {}) {
    sapFrame()?.contentWindow.postMessage({ channel: CHANNEL, type, ...more }, SAP);
  }
  function finish(error) {
    if (!job) return;
    const current = job;
    if (current.timer) clearTimeout(current.timer);
    if (current.probe) clearInterval(current.probe);
    job = null;
    if (error) current.reject(new Error(error));
    else current.resolve(current.date + " 결재선 준비 완료: " + feature.preset.approvers.join(" → ") + "\n최종 결재상신을 직접 누르세요.");
  }
  window.addEventListener("message", event => {
    if (!job?.accepting || event.origin !== SAP || event.source !== sapFrame()?.contentWindow) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL) return;
    if (message.type === "ready" && !job.started) {
      job.instance = message.instance;
      send("run", { instance: message.instance, id: job.id, date: job.date });
      return;
    }
    if (message.id !== job.id || message.instance !== job.instance) return;
    if (message.type === "started") {
      job.started = true;
      clearInterval(job.probe);
    } else if (message.type === "progress") {
      job.report("진행 중: " + message.text);
    } else if (message.type === "complete") finish();
    else if (message.type === "error") finish(message.text);
  });

  async function navigate() {
    await selectMenu('[toptabindex]', "일반행정", () => findMenu('[subtabindex]', "인사"));
    await selectMenu('[subtabindex]', "인사", () => findMenu('[nodetitle]', "국내출장 신청"));
    await selectMenu('[nodetitle]', "국내출장 신청", sapFrame);
    job.report("국내출장 신청 화면을 여는 중…");
    job.accepting = true;
    job.probe = setInterval(() => send("probe"), 250);
    job.timer = setTimeout(() => {
      if (!job) return;
      if (!job.started) finish("출장 신청 화면이 준비되지 않았습니다. 포탈을 확인하고 다시 실행하세요.");
      else job.report("포탈 응답을 기다리고 있습니다. 중복 실행하지 말고 열린 안내 창을 확인하세요.");
    }, 180000);
    send("probe");
  }
  function start(date, report) {
    if (job) return Promise.reject(new Error("이미 출장신청을 준비하고 있습니다."));
    return new Promise((resolve, reject) => {
      job = { id: crypto.randomUUID(), date, report, resolve, reject, accepting: false };
      navigate().catch(error => finish(error.message));
    });
  }
  launcher.register(feature.launcherDefinition(start));
})();
