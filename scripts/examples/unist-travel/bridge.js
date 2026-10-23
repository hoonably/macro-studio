"use strict";

(() => {
  const helper = window.MacroStudio;
  const feature = helper.features.travelRequest;
  const CHANNEL = "macro-studio-unist-travel-v1";
  const PORTAL = "https://portal.unist.ac.kr";
  const instance = crypto.randomUUID();
  let running = false;
  const handled = new Set();
  const normalize = value => String(value || "").replace(/\s+/g, " ").trim();
  const label = el => {
    try { return normalize(JSON.parse(el.getAttribute("lsdata") || "{}")["0"]); }
    catch { return ""; }
  };
  const visible = el => el.getClientRects().length > 0 && el.getAttribute("aria-disabled") !== "true";
  const buttons = () => [...document.querySelectorAll('[ct="B"]')].filter(visible);
  const newRequest = () => buttons().filter(el => ["신청", "신규 신청", "신규신청"].includes(label(el)));
  const formReady = () => helper.sap.locate(document, "begda_cp") &&
    buttons().some(el => label(el) === "신규 결재상신");
  const send = (type, payload = {}) => window.top.postMessage({ channel: CHANNEL, type, instance, ...payload }, PORTAL);
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function runFromList(date, progress) {
    if (!formReady()) {
      const candidates = newRequest();
      if (candidates.length !== 1) throw new Error("조회 화면의 신규 신청 버튼을 하나로 찾지 못했습니다.");
      const button = candidates[0];
      const session = helper.sap.connectButton(button);
      progress("신규 신청서 열기");
      await session.press(button, label(button));
      const deadline = Date.now() + 30000;
      while (!formReady()) {
        if (Date.now() >= deadline) throw new Error("신규 신청서가 열리지 않았습니다. 포탈 안내를 확인하세요.");
        await session.ready();
        if ([...document.querySelectorAll('[role="dialog"]')].some(visible)) {
          throw new Error("신규 신청 중 안내 창이 열렸습니다. 내용을 직접 확인하세요.");
        }
        await pause(50);
      }
    }
    return feature.run(date, progress);
  }
  feature.runFromList = runFromList;

  window.addEventListener("message", async event => {
    if (event.origin !== PORTAL || event.source !== window.top) return;
    const message = event.data;
    if (!message || message.channel !== CHANNEL) return;
    if (message.type === "probe") {
      if (!running && window.UCF_Automation?.Actions && (formReady() || newRequest().length === 1)) send("ready");
      return;
    }
    if (message.type !== "run" || message.instance !== instance ||
        typeof message.id !== "string" || !/^\d{4}\.\d{2}\.\d{2}$/.test(message.date)) return;
    if (handled.has(message.id) || running) return;
    handled.add(message.id);
    running = true;
    send("started", { id: message.id });
    try {
      await runFromList(message.date, text => send("progress", { id: message.id, text }));
      send("complete", { id: message.id });
    } catch (error) {
      send("error", { id: message.id, text: error.message });
    } finally {
      running = false;
    }
  });
})();
