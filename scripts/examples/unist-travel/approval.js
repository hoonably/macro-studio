"use strict";

(() => {
  const helper = window.MacroStudio;
  const feature = helper.features.travelRequest;
  const normalize = text => String(text || "").replace(/\s+/g, " ").trim();
  const isVisible = el => !!el && el.getClientRects().length > 0;
  const buttonLabel = el => JSON.parse(el.getAttribute("lsdata") || "{}")["0"];
  const pause = () => new Promise(resolve => setTimeout(resolve, 25));

  function stage(doc) {
    const dialogs = [...doc.querySelectorAll('[role="dialog"]')].filter(isVisible);
    if (!dialogs.length) return { kind: "form" };
    if (dialogs.length !== 1) return { kind: "other" };
    const popup = dialogs[0];
    const picker = helper.sap.locate(doc, "v_main.ddl");
    if (picker && popup.contains(picker)) return { kind: "line", popup, picker };
    const prompt = [...popup.querySelectorAll('[ct="TV"]')].find(el =>
      normalize(el.textContent) === "결재상신을 하시겠습니까?");
    if (prompt) return { kind: "confirm", popup };
    return { kind: "other" };
  }

  function approverRows(doc) {
    // 실제 SAP 필드명의 철자가 talbe입니다.
    const table = helper.sap.locate(doc, "v_main.talbe");
    return table ? [...table.querySelectorAll('tr[rt="1"]')].map(row =>
      normalize(row.querySelector('td[role="gridcell"]')?.textContent)).filter(Boolean) : [];
  }

  function rowsMatch(doc, preset) {
    const rows = approverRows(doc).slice(1); // 첫 행은 신청자
    return rows.length === preset.approvers.length &&
      rows.every((text, index) => text === preset.approvers[index] ||
        text.startsWith(preset.approvers[index] + " "));
  }

  async function waitFor(session, read, message) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      await session.ready();
      const value = read();
      if (value) return value;
      await pause();
    }
    throw new Error(message);
  }

  feature.prepareApproval = async function (onProgress = () => {}, preset = feature.preset) {
    feature.ensureConfigured(preset);
    const session = helper.sap.connect("begda_cp");
    return session.runExclusive("출장 결재선 준비", async () => {
      await session.ready();
      let current = stage(session.doc);
      if (current.kind === "form") {
        onProgress("신규 결재상신 화면 열기");
        await session.press("request", "신규 결재상신");
        current = await waitFor(session, () => {
          const next = stage(session.doc);
          return next.kind !== "form" && next;
        }, "결재선 준비 화면이 열리지 않았습니다. 포탈 메시지를 확인하세요.");
      }

      if (current.kind === "confirm") {
        const yes = [...current.popup.querySelectorAll('[ct="B"]')].filter(el =>
          isVisible(el) && buttonLabel(el) === "예");
        if (yes.length !== 1) throw new Error("확인 창의 예 버튼을 하나로 찾지 못했습니다.");
        onProgress("결재선 설정으로 이동");
        await session.press(yes[0], "예");
        current = await waitFor(session, () => {
          const next = stage(session.doc);
          return (next.kind === "line" || next.kind === "other") && next;
        }, "결재선 목록이 열리지 않았습니다. 포탈 메시지를 확인하세요.");
      }

      if (current.kind !== "line") throw new Error("예상하지 못한 안내 창입니다. 내용을 직접 확인하세요.");
      const category = helper.sap.locate(session.doc, "v_main.text02");
      if (normalize(category?.textContent) !== "[출장]") throw new Error("출장 결재선 화면이 아닙니다.");

      const list = session.doc.getElementById(current.picker.getAttribute("aria-controls"));
      const options = list ? [...list.querySelectorAll("[data-itemkey]")].filter(el =>
        normalize(el.getAttribute("data-itemvalue1")) === normalize(preset.approvalLine)) : [];
      if (options.length !== 1) throw new Error("설정한 저장 결재선을 하나로 찾지 못했습니다.");
      onProgress("설정한 결재선 선택");
      const value = options[0].getAttribute("data-itemvalue1");
      await session.set("v_main.ddl", value);

      await waitFor(session, () => {
        const next = stage(session.doc);
        if (next.kind !== "line") return false;
        return normalize(next.picker.value) === normalize(preset.approvalLine) &&
          rowsMatch(session.doc, preset);
      }, "설정한 결재선이 반영되지 않았습니다. 최종 상신 전에 확인하세요.");

      // 여기서 끝납니다. 팝업 하단의 최종 '결재상신' 버튼은 실행하지 않습니다.
      return { approvalLine: preset.approvalLine, approvers: approverRows(session.doc) };
    });
  };

  feature.run = async function (date, onProgress = () => {}, inputs = {}) {
    const { preset } = feature.resolveTrip(date, inputs);
    const session = helper.sap.connect("begda_cp");
    const current = stage(session.doc);
    if (current.kind === "other") throw new Error("열린 안내 창을 먼저 확인하고 다시 실행하세요.");
    if (current.kind === "form") {
      await feature.fill(date, onProgress, inputs);
    } else if (feature.tripTasks(date, preset).some(([, name, expected]) => session.read(name) !== expected)) {
      throw new Error("결재선 창이 열려 있습니다. 날짜·시간 등 입력값을 바꾸려면 창을 닫고 다시 실행하세요.");
    }
    return feature.prepareApproval(onProgress, preset);
  };
})();
